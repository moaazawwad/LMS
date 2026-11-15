import { HttpException } from '@nestjs/common';
import { LoginLimiter } from '../auth/login-limiter.js';
import { productionConfigProblems } from './security.js';

describe('productionConfigProblems', () => {
  const good = {
    NODE_ENV: 'production',
    JWT_SECRET: 'k3J9x0QmT7vLr2Wq8ZpN4sYb6HdF1cGa',
    DATABASE_URL: 'postgresql://x',
  };

  it('passes a sound production setup, and anything outside production', () => {
    expect(productionConfigProblems(good)).toEqual([]);
    expect(productionConfigProblems({ JWT_SECRET: 'short' })).toEqual([]);
  });

  it('refuses short or placeholder secrets and a missing database', () => {
    expect(
      productionConfigProblems({ ...good, JWT_SECRET: 'too-short' }),
    ).toHaveLength(1);
    expect(
      productionConfigProblems({
        ...good,
        JWT_SECRET: 'change-me-to-a-long-random-string-please',
      })[0],
    ).toMatch(/placeholder/);
    expect(
      productionConfigProblems({ ...good, DATABASE_URL: undefined }),
    ).toEqual(['DATABASE_URL is not set.']);
  });
});

describe('LoginLimiter', () => {
  const limits = { perEmail: 3, perAddress: 5, windowMs: 60_000 };
  const blocked = (fn: () => void) => {
    try {
      fn();
      return false;
    } catch (e) {
      return e instanceof HttpException && e.getStatus() === 429;
    }
  };

  it('locks an email after too many wrong passwords, then lets it go after the window', () => {
    const l = new LoginLimiter(limits);
    expect(l.fail('a@x.com', '1.1.1.1', 0)).toBe(false);
    expect(l.fail('A@x.com ', '1.1.1.1', 1)).toBe(false); // same email, any case
    expect(blocked(() => l.check('a@x.com', '1.1.1.1', 2))).toBe(false);
    expect(l.fail('a@x.com', '1.1.1.1', 3)).toBe(true); // this one locks it
    expect(blocked(() => l.check('a@x.com', '2.2.2.2', 4))).toBe(true); // from anywhere
    expect(blocked(() => l.check('b@x.com', '2.2.2.2', 4))).toBe(false); // others unaffected
    expect(blocked(() => l.check('a@x.com', '1.1.1.1', 60_000))).toBe(false); // window over
  });

  it('a right password clears the count for that email', () => {
    const l = new LoginLimiter(limits);
    l.fail('a@x.com', '1.1.1.1', 0);
    l.fail('a@x.com', '1.1.1.1', 0);
    l.succeed('a@x.com');
    l.fail('a@x.com', '1.1.1.1', 0);
    l.fail('a@x.com', '1.1.1.1', 0);
    expect(blocked(() => l.check('a@x.com', '1.1.1.1', 1))).toBe(false);
  });

  it('limits one address trying many emails', () => {
    const l = new LoginLimiter(limits);
    for (let i = 0; i < 5; i++) l.fail(`user${i}@x.com`, '9.9.9.9', 0);
    expect(blocked(() => l.check('new@x.com', '9.9.9.9', 1))).toBe(true);
    expect(blocked(() => l.check('new@x.com', '8.8.8.8', 1))).toBe(false);
  });
});
