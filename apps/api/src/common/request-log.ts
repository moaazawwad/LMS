import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** An id we accept from a proxy in front of us; anything else gets a fresh one. */
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

export interface RequestLogLine {
  t: string;
  id: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  user?: string;
  role?: string;
}

/**
 * Gives every API request an id (sent back as X-Request-Id, shown in error
 * answers) and, unless `quiet`, writes one JSON line when it finishes:
 * method, path (no query string, so no personal data from search boxes),
 * status, time taken and who asked.
 */
export function requestLog(
  options: { quiet?: boolean; write?: (line: RequestLogLine) => void } = {},
) {
  const write =
    options.write ??
    ((line: RequestLogLine) =>
      process.stdout.write(`${JSON.stringify(line)}\n`));
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api')) return next();
    const incoming = req.header('x-request-id');
    const id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
    (req as Request & { id?: string }).id = id;
    res.setHeader('X-Request-Id', id);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      if (options.quiet) return;
      const user = (
        req as Request & { user?: { userId: string; role: string } }
      ).user;
      write({
        t: new Date().toISOString(),
        id,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Math.round(Number(process.hrtime.bigint() - started) / 1e5) / 10,
        ...(user ? { user: user.userId, role: user.role } : {}),
      });
    });
    next();
  };
}
