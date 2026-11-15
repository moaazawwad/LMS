import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

/** Wrong passwords allowed per email, and per network address, in one window. */
export const LOGIN_LIMITS = {
  perEmail: 5,
  perAddress: 30,
  windowMs: 15 * 60_000,
};

interface Bucket {
  failures: number;
  /** when the window started */
  since: number;
}

/**
 * Slows down password guessing: after too many wrong passwords for one email
 * (or from one address) sign-in is refused until the window passes.
 * Kept in memory, which suits the single-service deployment; a restart clears it.
 */
@Injectable()
export class LoginLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly limits = LOGIN_LIMITS) {}

  /** Throws 429 when this email or address is locked right now. */
  check(email: string, address: string, now = Date.now()) {
    for (const [key, max] of this.keys(email, address)) {
      const b = this.live(key, now);
      if (b && b.failures >= max) {
        const minutes = Math.max(
          1,
          Math.ceil((b.since + this.limits.windowMs - now) / 60_000),
        );
        throw new HttpException(
          {
            statusCode: 429,
            error: 'Too Many Requests',
            message: `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask the academy to reset it.`,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
  }

  /** Records a wrong password. Returns true when this one locked the email. */
  fail(email: string, address: string, now = Date.now()): boolean {
    let lockedEmail = false;
    for (const [key, max] of this.keys(email, address)) {
      const b = this.live(key, now) ?? { failures: 0, since: now };
      b.failures++;
      this.buckets.set(key, b);
      if (key.startsWith('e:') && b.failures === max) lockedEmail = true;
    }
    this.sweep(now);
    return lockedEmail;
  }

  /** A correct password clears that email's count (not the address's). */
  succeed(email: string) {
    this.buckets.delete(`e:${email.trim().toLowerCase()}`);
  }

  private keys(email: string, address: string): [string, number][] {
    return [
      [`e:${email.trim().toLowerCase()}`, this.limits.perEmail],
      [`a:${address}`, this.limits.perAddress],
    ];
  }

  private live(key: string, now: number) {
    const b = this.buckets.get(key);
    if (b && now - b.since >= this.limits.windowMs) {
      this.buckets.delete(key);
      return undefined;
    }
    return b;
  }

  /** Keeps memory bounded: drop expired windows now and then. */
  private sweep(now: number) {
    if (this.buckets.size < 10_000) return;
    for (const [key, b] of this.buckets)
      if (now - b.since >= this.limits.windowMs) this.buckets.delete(key);
  }
}
