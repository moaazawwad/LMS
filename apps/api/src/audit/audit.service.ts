import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { type AuthUser, actorKindOf } from '../common/auth-user.js';
import { DB, type Db, type Executor } from '../db/db.module.js';
import {
  type ActorKind,
  auditLogs,
  invoices,
  lessons,
  students,
  subscriptions,
  teachers,
  users,
} from '../db/schema.js';

/** One field that changed: "phone: 0100 → 0111". */
export interface FieldChange {
  field: string;
  from: string;
  to: string;
}

/** Who an entry is about: the student and/or teacher, or another user. */
export interface AuditAbout {
  student?: { id: string; name: string };
  teacher?: { id: string; name: string };
  user?: { id: string; name: string; role: string };
}

/** Fields never shown as changes (ids, secrets, bookkeeping). */
const HIDDEN =
  /(^id$|Id$|At$|^passwordHash$|^password$|^token|Hash$|^windows$|^slots$|^moved$)/;

function show(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') return v.length > 80 ? `${v.slice(0, 77)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x !== 'object' || x === null))
    return v.length ? v.join(', ') : '—';
  return null; // objects: not shown field by field
}

/**
 * The simple fields an entry changed, from its before/after snapshots. Only
 * fields present in `after` count, so partial updates list just what was sent.
 */
export function fieldChanges(before: unknown, after: unknown): FieldChange[] {
  if (
    !before ||
    !after ||
    typeof before !== 'object' ||
    typeof after !== 'object'
  )
    return [];
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const out: FieldChange[] = [];
  for (const field of Object.keys(a)) {
    if (HIDDEN.test(field) || !(field in b)) continue;
    const from = show(b[field]);
    const to = show(a[field]);
    if (from === null || to === null || from === to) continue;
    out.push({ field, from, to });
  }
  return out.slice(0, 8);
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  override?: boolean;
  note?: string | null;
}

export interface AuditQuery {
  actorKind?: ActorKind;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  /** words to find in the summary or the note */
  q?: string;
  /** actions starting with any of these, e.g. ['lesson.', 'homework.'] (a page's own log) */
  actions?: string[];
  /** everything about one student or teacher: them, their lessons, weekly lessons, invoices */
  studentId?: string;
  teacherId?: string;
}

/** Entries about a student: theirs and their lessons, subscriptions, invoices, applications. */
function aboutStudent(id: string): SQL {
  return sql`(
    (${auditLogs.entityType} = 'student' and ${auditLogs.entityId} = ${id})
    or (${auditLogs.entityType} = 'user' and ${auditLogs.entityId} in (select user_id::text from students where id = ${id}::uuid))
    or (${auditLogs.entityType} = 'lesson' and ${auditLogs.entityId} in (select id::text from lessons where student_id = ${id}::uuid))
    or (${auditLogs.entityType} = 'subscription' and ${auditLogs.entityId} in (select id::text from subscriptions where student_id = ${id}::uuid))
    or (${auditLogs.entityType} = 'invoice' and ${auditLogs.entityId} in (select id::text from invoices where student_id = ${id}::uuid))
    or (${auditLogs.entityType} = 'application' and ${auditLogs.entityId} in (select id::text from applications where student_id = ${id}::uuid))
  )`;
}

/** Entries about a teacher: theirs (hours, pay) and their lessons and weekly lessons. */
function aboutTeacher(id: string): SQL {
  return sql`(
    (${auditLogs.entityType} = 'teacher' and ${auditLogs.entityId} = ${id})
    or (${auditLogs.entityType} = 'user' and ${auditLogs.entityId} in (select user_id::text from teachers where id = ${id}::uuid))
    or (${auditLogs.entityType} = 'lesson' and ${auditLogs.entityId} in (select id::text from lessons where teacher_id = ${id}::uuid))
    or (${auditLogs.entityType} = 'subscription' and ${auditLogs.entityId} in (select id::text from subscriptions where teacher_id = ${id}::uuid))
  )`;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Write one entry. Pass the transaction so the log commits with the change. */
  async record(
    exec: Executor,
    actor: AuthUser | null,
    entry: AuditEntry,
  ): Promise<void> {
    await exec.insert(auditLogs).values({
      actorId: actor?.userId ?? null,
      actorKind: actorKindOf(actor),
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      summary: entry.summary,
      before: entry.before ?? null,
      after: entry.after ?? null,
      override: entry.override ?? false,
      note: entry.note ?? null,
    });
  }

  async list(q: AuditQuery) {
    const where: SQL[] = [];
    if (q.actorKind) where.push(eq(auditLogs.actorKind, q.actorKind));
    if (q.action) where.push(eq(auditLogs.action, q.action));
    if (q.entityType) where.push(eq(auditLogs.entityType, q.entityType));
    if (q.entityId) where.push(eq(auditLogs.entityId, q.entityId));
    if (q.from) where.push(gte(auditLogs.at, q.from));
    if (q.to) where.push(lt(auditLogs.at, q.to));
    if (q.actions?.length)
      where.push(
        or(
          ...q.actions.map((a) =>
            a.endsWith('.')
              ? ilike(
                  auditLogs.action,
                  `${a.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
                )
              : eq(auditLogs.action, a),
          ),
        )!,
      );
    if (q.studentId) where.push(aboutStudent(q.studentId));
    if (q.teacherId) where.push(aboutTeacher(q.teacherId));
    const text = q.q?.trim();
    if (text) {
      const like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(
        or(ilike(auditLogs.summary, like), ilike(auditLogs.note, like))!,
      );
    }
    const rows = await this.db
      .select({
        id: auditLogs.id,
        at: auditLogs.at,
        actorKind: auditLogs.actorKind,
        actorName: users.fullName,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        summary: auditLogs.summary,
        before: auditLogs.before,
        after: auditLogs.after,
        override: auditLogs.override,
        note: auditLogs.note,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(auditLogs.at))
      .limit(Math.min(q.limit ?? 50, 200));
    const about = await this.aboutOf(rows);
    return rows.map((r) => ({
      ...r,
      /** the student and/or teacher (or user) the entry is about */
      about: about.get(`${r.entityType}:${r.entityId}`) ?? null,
      /** simple fields that changed, "from → to" */
      changes: fieldChanges(r.before, r.after),
    }));
  }

  /** Names of the people each entry is about, looked up in a few queries. */
  private async aboutOf(
    rows: { entityType: string; entityId: string }[],
  ): Promise<Map<string, AuditAbout>> {
    const ids = (type: string) => [
      ...new Set(
        rows.filter((r) => r.entityType === type).map((r) => r.entityId),
      ),
    ];
    const out = new Map<string, AuditAbout>();
    const su = alias(users, 'student_user');
    const tu = alias(users, 'teacher_user');
    const pair = (r: {
      studentId: string | null;
      studentName: string | null;
      teacherId: string | null;
      teacherName: string | null;
    }): AuditAbout => ({
      ...(r.studentId && r.studentName
        ? { student: { id: r.studentId, name: r.studentName } }
        : {}),
      ...(r.teacherId && r.teacherName
        ? { teacher: { id: r.teacherId, name: r.teacherName } }
        : {}),
    });
    const people = {
      studentId: students.id,
      studentName: su.fullName,
      teacherId: teachers.id,
      teacherName: tu.fullName,
    };
    const valid = (list: string[]) =>
      list.filter((id) => /^[0-9a-f-]{36}$/i.test(id));

    const lessonIds = valid(ids('lesson'));
    if (lessonIds.length)
      for (const r of await this.db
        .select({ id: lessons.id, ...people })
        .from(lessons)
        .leftJoin(students, eq(students.id, lessons.studentId))
        .leftJoin(su, eq(su.id, students.userId))
        .leftJoin(teachers, eq(teachers.id, lessons.teacherId))
        .leftJoin(tu, eq(tu.id, teachers.userId))
        .where(inArray(lessons.id, lessonIds)))
        out.set(`lesson:${r.id}`, pair(r));

    const subIds = valid(ids('subscription'));
    if (subIds.length)
      for (const r of await this.db
        .select({ id: subscriptions.id, ...people })
        .from(subscriptions)
        .leftJoin(students, eq(students.id, subscriptions.studentId))
        .leftJoin(su, eq(su.id, students.userId))
        .leftJoin(teachers, eq(teachers.id, subscriptions.teacherId))
        .leftJoin(tu, eq(tu.id, teachers.userId))
        .where(inArray(subscriptions.id, subIds)))
        out.set(`subscription:${r.id}`, pair(r));

    const invoiceIds = valid(ids('invoice'));
    if (invoiceIds.length)
      for (const r of await this.db
        .select({ id: invoices.id, studentId: students.id, name: su.fullName })
        .from(invoices)
        .innerJoin(students, eq(students.id, invoices.studentId))
        .innerJoin(su, eq(su.id, students.userId))
        .where(inArray(invoices.id, invoiceIds)))
        out.set(`invoice:${r.id}`, {
          student: { id: r.studentId, name: r.name },
        });

    const studentIds = valid(ids('student'));
    if (studentIds.length)
      for (const r of await this.db
        .select({ id: students.id, name: su.fullName })
        .from(students)
        .innerJoin(su, eq(su.id, students.userId))
        .where(inArray(students.id, studentIds)))
        out.set(`student:${r.id}`, { student: { id: r.id, name: r.name } });

    const teacherIds = valid(ids('teacher'));
    if (teacherIds.length)
      for (const r of await this.db
        .select({ id: teachers.id, name: tu.fullName })
        .from(teachers)
        .innerJoin(tu, eq(tu.id, teachers.userId))
        .where(inArray(teachers.id, teacherIds)))
        out.set(`teacher:${r.id}`, { teacher: { id: r.id, name: r.name } });

    const userIds = valid(ids('user'));
    if (userIds.length) {
      const found = await this.db
        .select({
          id: users.id,
          name: users.fullName,
          role: users.role,
          studentId: students.id,
          teacherId: teachers.id,
        })
        .from(users)
        .leftJoin(students, eq(students.userId, users.id))
        .leftJoin(teachers, eq(teachers.userId, users.id))
        .where(inArray(users.id, userIds));
      for (const r of found)
        out.set(
          `user:${r.id}`,
          r.studentId
            ? { student: { id: r.studentId, name: r.name } }
            : r.teacherId
              ? { teacher: { id: r.teacherId, name: r.name } }
              : { user: { id: r.id, name: r.name, role: r.role } },
        );
    }
    return out;
  }
}
