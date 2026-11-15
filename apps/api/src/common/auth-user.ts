import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { ActorKind, Role } from '../db/schema.js';

/** What every request knows about the signed-in person (from the JWT). */
export interface AuthUser {
  userId: string;
  role: Role;
  fullName: string;
  timezone: string;
  teacherId?: string;
  studentId?: string;
  /** STAFF: the areas they may use; null or missing = all (admins always all) */
  areas?: StaffArea[] | null;
}

/**
 * The parts of the academy a staff account can be given. Admins have all of
 * them; a staff account has the ones the admin ticked (all, by default).
 * - students: add and edit students, subscriptions, extra lessons
 * - teachers: add and edit teachers and their weekly hours
 * - lessons: cancel or move lessons, check attendance, answer requests
 * - billing: invoices and CSV downloads
 * - catalog: curricula
 * - logs: the activity log
 * Everyone on the staff can still look up students, teachers and lessons.
 */
export const STAFF_AREAS = [
  'students',
  'teachers',
  'lessons',
  'billing',
  'catalog',
  'logs',
] as const;
export type StaffArea = (typeof STAFF_AREAS)[number];

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

/** Skip the JWT check (login, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Only these roles may call the route. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const AREA = 'staffArea';

/** Staff accounts need this area for the route; other roles are not affected. */
export const Area = (area: StaffArea) => SetMetadata(AREA, area);

/** Whether this person may use an area (only staff accounts can be limited). */
export function canUse(user: AuthUser, area: StaffArea): boolean {
  if (user.role !== 'STAFF') return true;
  return !user.areas || user.areas.includes(area);
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    return ctx.switchToHttp().getRequest().user as AuthUser;
  },
);

export function isStaff(user: AuthUser): boolean {
  return user.role === 'ADMIN' || user.role === 'STAFF';
}

export function actorKindOf(user: AuthUser | null): ActorKind {
  if (!user) return 'SYSTEM';
  if (user.role === 'TEACHER') return 'TEACHER';
  if (user.role === 'STUDENT') return 'STUDENT';
  return 'ADMIN';
}
