import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

/** Readable messages for the unique rules in the schema. */
const UNIQUE_MESSAGES: Record<string, string> = {
  plans_tier_unique:
    'There is already a plan for this level. Edit that one instead.',
  curricula_name_unique: 'A curriculum with this name already exists.',
  users_email_unique: 'This email is already used.',
  change_requests_one_open_idx:
    'There is already an open request for this lesson.',
  billing_cycles_sub_index: 'That cycle already exists.',
};

interface PgError {
  code?: string;
  constraint?: string;
}

/** The PostgreSQL error inside a Drizzle error (or the error itself). */
function pgErrorOf(err: unknown): PgError | null {
  for (
    let e: unknown = err, depth = 0;
    e && depth < 3;
    e = (e as { cause?: unknown }).cause, depth++
  ) {
    const code = (e as PgError).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code))
      return e as PgError;
  }
  return null;
}

/**
 * Turns database rule errors into clear 4xx answers instead of a 500:
 * a duplicate → 409, something still in use → 409, a malformed value → 400.
 * Everything else is left to Nest's normal handling.
 */
@Catch()
export class DbErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('DbErrorFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    const pg = pgErrorOf(exception);
    if (pg?.code === '23505') {
      const message =
        (pg.constraint && UNIQUE_MESSAGES[pg.constraint]) ??
        'That already exists.';
      res
        .status(HttpStatus.CONFLICT)
        .json({ statusCode: 409, error: 'Conflict', message });
      return;
    }
    if (pg?.code === '23503') {
      res.status(HttpStatus.CONFLICT).json({
        statusCode: 409,
        error: 'Conflict',
        message:
          'It is still used somewhere else, so it cannot be changed this way.',
      });
      return;
    }
    if (pg?.code === '22P02' || pg?.code === '22007' || pg?.code === '22008') {
      res.status(HttpStatus.BAD_REQUEST).json({
        statusCode: 400,
        error: 'Bad Request',
        message: 'A value has the wrong format.',
      });
      return;
    }
    const requestId = host.switchToHttp().getRequest<{ id?: string }>().id;
    this.log.error(
      `[${requestId ?? '-'}] ${exception instanceof Error ? (exception.stack ?? exception.message) : String(exception)}`,
    );
    // The id lets support find this exact error in the logs.
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      message: 'Something went wrong on our side.',
      requestId,
    });
  }
}
