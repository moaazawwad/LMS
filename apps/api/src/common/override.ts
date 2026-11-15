import { RuleViolationException } from './errors.js';
import type { RuleViolation } from '../rules/lesson-rules.js';
import { type AuthUser, isStaff } from './auth-user.js';

export interface OverrideInput {
  override?: boolean;
  note?: string;
}

/**
 * Decide what to do with rule violations:
 * - none: carry on
 * - staff with override: carry on, flagged as an override in the log, which
 *   says which rules were set aside (staff don't have to write anything)
 * - anyone else: 422 with the violations
 * Returns true when the action goes ahead as an override.
 */
export function resolveViolations(
  user: AuthUser,
  violations: RuleViolation[],
  input: OverrideInput,
): boolean {
  if (violations.length === 0) return false;
  const staff = isStaff(user);
  if (staff && input.override) {
    const rules = violations
      .map((v) => v.message.replace(/\.$/, ''))
      .join('; ');
    const said = input.note?.trim();
    input.note = said ? `${said} (overrode: ${rules})` : `Overrode: ${rules}`;
    return true;
  }
  throw new RuleViolationException(violations, staff);
}
