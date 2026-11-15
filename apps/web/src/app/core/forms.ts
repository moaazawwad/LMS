import { HttpErrorResponse } from '@angular/common/http';
import { errorMessage } from './api.service';
import type { RuleViolationError } from './models';

/** A readable message plus whether staff may retry the action as an override. */
export function ruleError(err: unknown): { message: string; canOverride: boolean } {
  const body = err instanceof HttpErrorResponse ? (err.error as Partial<RuleViolationError>) : null;
  return { message: errorMessage(err), canOverride: !!body?.canOverride };
}

/** A temporary password that is easy to read out: no 0/O or 1/l. */
export function generatePassword(length = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export function dollarsToCents(value: string | number): number {
  return Math.round(Number(value) * 100);
}

export function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** "14:00" -> 840; "00:00" as an END time means midnight (1440). */
export function clockToMinutes(value: string, isEnd = false): number {
  const [h, m] = value.split(':').map(Number);
  const min = h * 60 + m;
  return isEnd && min === 0 ? 1440 : min;
}

export function minutesToInput(min: number): string {
  const m = min % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
