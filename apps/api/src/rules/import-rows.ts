/**
 * Reading people from a spreadsheet: every row is checked on its own and the
 * problems are said in plain words, so the admin can fix the file and try
 * again. Nothing here touches the database.
 */
import { randomInt } from 'node:crypto';

export const MAX_IMPORT_ROWS = 300;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LEVELS = ['PREMIUM', 'STANDARD', 'BASIC'] as const;
export type Level = (typeof LEVELS)[number];

export interface RawPersonRow {
  fullName?: string;
  email?: string;
  phone?: string;
  password?: string;
  /** students */
  timezone?: string;
  /** teachers */
  level?: string;
  curricula?: string;
  hourlyRate?: string;
  zoomLink?: string;
}

export interface RowCheck<T> {
  /** 1-based, as in the file after the header */
  row: number;
  fullName: string;
  email: string;
  problems: string[];
  value: T | null;
}

export interface StudentRowValue {
  fullName: string;
  email: string;
  phone: string | null;
  timezone: string;
  password: string | null;
}

export interface TeacherRowValue {
  fullName: string;
  email: string;
  phone: string | null;
  level: Level;
  curriculumNames: string[];
  hourlyRateCents: number | null;
  zoomLink: string | null;
  password: string | null;
}

const clean = (v: string | undefined) => (v ?? '').replace(/\s+/g, ' ').trim();

let zoneList: string[] | null = null;
function zones(): string[] {
  zoneList ??= Intl.supportedValuesOf('timeZone');
  return zoneList;
}

/**
 * An IANA time zone from what people type: "America/New_York" as is, or a
 * city such as "new york" or "Sydney". null when nothing matches.
 */
export function resolveTimeZone(input: string): string | null {
  const text = clean(input);
  if (!text) return null;
  try {
    // Canonical spelling, e.g. "america/new_york" -> "America/New_York".
    const canonical = new Intl.DateTimeFormat('en-US', {
      timeZone: text,
    }).resolvedOptions().timeZone;
    if (canonical) return canonical;
  } catch {
    // not an IANA name; try it as a city
  }
  const city = text.toLowerCase().replace(/[\s-]+/g, '_');
  return zones().find((z) => z.toLowerCase().split('/').pop() === city) ?? null;
}

/** A temporary password that is easy to read out: no 0/O or 1/l. */
export function readablePassword(length = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from({ length }, () => chars[randomInt(chars.length)]).join('');
}

function common(raw: RawPersonRow, problems: string[]) {
  const fullName = clean(raw.fullName);
  const email = clean(raw.email).toLowerCase();
  const phone = clean(raw.phone) || null;
  const password = clean(raw.password) || null;
  if (fullName.length < 2) problems.push('Name is missing.');
  if (!email) problems.push('Email is missing.');
  else if (!EMAIL.test(email))
    problems.push(`"${email}" is not an email address.`);
  if (password && password.length < 8)
    problems.push(
      'Password is shorter than 8 characters (leave it empty to get one made).',
    );
  return { fullName, email, phone, password };
}

/** Same email twice in one file. */
function markRepeats<T>(checks: RowCheck<T>[]) {
  const first = new Map<string, number>();
  for (const c of checks) {
    if (!c.email) continue;
    const seen = first.get(c.email);
    if (seen !== undefined) {
      c.problems.push(`Same email as row ${seen}.`);
      c.value = null;
    } else first.set(c.email, c.row);
  }
}

export function checkStudentRows(
  rows: RawPersonRow[],
): RowCheck<StudentRowValue>[] {
  const checks = rows.map((raw, i) => {
    const problems: string[] = [];
    const base = common(raw, problems);
    const timezone = resolveTimeZone(raw.timezone ?? '');
    if (!clean(raw.timezone))
      problems.push(
        'Time zone is missing (for example America/New_York, or a city like Sydney).',
      );
    else if (!timezone)
      problems.push(
        `Unknown time zone "${clean(raw.timezone)}". Use a name like America/New_York, or a big city like Toronto.`,
      );
    return {
      row: i + 1,
      fullName: base.fullName,
      email: base.email,
      problems,
      value: problems.length ? null : { ...base, timezone: timezone! },
    };
  });
  markRepeats(checks);
  return checks;
}

/** "Premium", "premium " → PREMIUM */
function level(input: string | undefined): Level | null {
  const v = clean(input).toUpperCase();
  return (LEVELS as readonly string[]).includes(v) ? (v as Level) : null;
}

/** "200", "200.50", "EGP 200" → cents; '' → null; anything else → NaN */
function rateCents(input: string | undefined): number | null {
  const v = clean(input)
    .replace(/^[A-Za-z]{3}\s*/, '')
    .replace(/,/g, '');
  if (!v) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return Number.NaN;
  return Math.round(Number(v) * 100);
}

export function checkTeacherRows(
  rows: RawPersonRow[],
  knownCurricula: string[],
): RowCheck<TeacherRowValue>[] {
  const byName = new Map(knownCurricula.map((n) => [n.toLowerCase(), n]));
  const checks = rows.map((raw, i) => {
    const problems: string[] = [];
    const base = common(raw, problems);
    const lvl = level(raw.level);
    if (!clean(raw.level))
      problems.push('Level is missing (Premium, Standard or Basic).');
    else if (!lvl)
      problems.push(
        `Level "${clean(raw.level)}" should be Premium, Standard or Basic.`,
      );
    const names = clean(raw.curricula)
      .split(/[;,|]/)
      .map((n) => n.trim())
      .filter(Boolean);
    const unknown = names.filter((n) => !byName.has(n.toLowerCase()));
    if (unknown.length)
      problems.push(
        `Not in Curricula & plans: ${unknown.map((n) => `"${n}"`).join(', ')}. Add them there first or fix the spelling.`,
      );
    const rate = rateCents(raw.hourlyRate);
    if (Number.isNaN(rate))
      problems.push(
        `Hourly rate "${clean(raw.hourlyRate)}" should be a number, like 200.`,
      );
    const zoomLink = clean(raw.zoomLink) || null;
    if (zoomLink && !/^https?:\/\/\S+$/.test(zoomLink))
      problems.push('Class link should start with https://.');
    return {
      row: i + 1,
      fullName: base.fullName,
      email: base.email,
      problems,
      value: problems.length
        ? null
        : {
            ...base,
            level: lvl!,
            curriculumNames: [
              ...new Set(names.map((n) => byName.get(n.toLowerCase())!)),
            ],
            hourlyRateCents: rate,
            zoomLink,
          },
    };
  });
  markRepeats(checks);
  return checks;
}
