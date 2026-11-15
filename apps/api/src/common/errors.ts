import { UnprocessableEntityException } from '@nestjs/common';
import type { RuleViolation } from '../rules/lesson-rules.js';

/**
 * Thrown when a business rule blocks an action.
 * The client gets every violation so it can explain why, and admins can
 * retry with { override: true, note } where the route allows it.
 */
export class RuleViolationException extends UnprocessableEntityException {
  constructor(violations: RuleViolation[], canOverride: boolean) {
    super({
      statusCode: 422,
      error: 'RuleViolation',
      message: violations.map((v) => v.message).join(' '),
      violations,
      canOverride,
    });
  }
}
