import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import { type RequestLogLine, requestLog } from './request-log.js';

function fakeHttp(path: string, headers: Record<string, string> = {}) {
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
    },
  });
  const req = {
    path,
    method: 'GET',
    header: (k: string) => headers[k.toLowerCase()],
  } as unknown as Request;
  return { req, res: res as unknown as Response & typeof res };
}

describe('requestLog', () => {
  it('gives each API request an id and logs one line without the query string', () => {
    const lines: RequestLogLine[] = [];
    const { req, res } = fakeHttp('/api/students');
    const next = vi.fn() as NextFunction;
    requestLog({ write: (l) => lines.push(l) })(req, res, next);
    expect(next).toHaveBeenCalled();
    const id = res.headers['x-request-id'];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    (req as Request & { user?: object }).user = { userId: 'u1', role: 'ADMIN' };
    res.statusCode = 403;
    res.emit('finish');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      id,
      method: 'GET',
      path: '/api/students',
      status: 403,
      user: 'u1',
      role: 'ADMIN',
    });
  });

  it('keeps a safe id from a proxy, replaces an unsafe one', () => {
    const a = fakeHttp('/api/health', { 'x-request-id': 'edge-1234abcd' });
    requestLog({ quiet: true })(a.req, a.res, vi.fn() as NextFunction);
    expect(a.res.headers['x-request-id']).toBe('edge-1234abcd');
    const b = fakeHttp('/api/health', { 'x-request-id': '<script>' });
    requestLog({ quiet: true })(b.req, b.res, vi.fn() as NextFunction);
    expect(b.res.headers['x-request-id']).not.toBe('<script>');
  });

  it('ignores the web app files', () => {
    const { req, res } = fakeHttp('/admin/today');
    const next = vi.fn() as NextFunction;
    requestLog()(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.headers['x-request-id']).toBeUndefined();
  });
});
