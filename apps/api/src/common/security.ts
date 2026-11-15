import type { HelmetOptions } from 'helmet';

/**
 * Settings that must be right before real people use the system.
 * Returns what is wrong (empty = fine). Checked at startup in production.
 */
export function productionConfigProblems(
  env: Record<string, string | undefined>,
): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  const secret = env.JWT_SECRET ?? '';
  if (secret.length < 32)
    problems.push(
      'JWT_SECRET must be at least 32 characters (use a long random string).',
    );
  if (/change-me|secret|password/i.test(secret))
    problems.push(
      'JWT_SECRET looks like a placeholder. Use a long random string.',
    );
  if (!env.DATABASE_URL) problems.push('DATABASE_URL is not set.');
  return problems;
}

/**
 * Security headers. The content policy allows only this site, plus Google
 * Fonts for the typeface; Angular's component styles need inline styles.
 */
export const helmetOptions: HelmetOptions = {
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  // Zoom links open in a new tab; nothing here is embedded cross-origin.
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
};
