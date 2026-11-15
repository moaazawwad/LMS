import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import {
  type AuthUser,
  STAFF_AREAS,
  type StaffArea,
} from '../common/auth-user.js';
import { DB, type Db } from '../db/db.module.js';
import { students, teachers, users } from '../db/schema.js';

/** Compared against when the email is unknown, so both cases take as long. */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const [row] = await this.db
      .select({
        user: users,
        teacherId: teachers.id,
        studentId: students.id,
      })
      .from(users)
      .leftJoin(teachers, eq(teachers.userId, users.id))
      .leftJoin(students, eq(students.userId, users.id))
      .where(eq(users.email, email.trim().toLowerCase()))
      .limit(1);

    // Same message, and about the same time, for an unknown email and a wrong password.
    const matches = await bcrypt.compare(
      password,
      row?.user.passwordHash ?? DUMMY_HASH,
    );
    if (!row || !row.user.isActive || !matches) {
      throw new UnauthorizedException('Email or password is wrong.');
    }

    const authUser: AuthUser = {
      userId: row.user.id,
      role: row.user.role,
      fullName: row.user.fullName,
      timezone: row.user.timezone,
      teacherId: row.teacherId ?? undefined,
      studentId: row.studentId ?? undefined,
      areas: areasOf(row.user.role, row.user.staffAreas),
    };
    const accessToken = await this.jwt.signAsync({
      sub: authUser.userId,
      ...authUser,
    });
    return { accessToken, user: authUser };
  }

  async profile(userId: string) {
    const [u] = await this.db
      .select({
        fullName: users.fullName,
        email: users.email,
        phone: users.phone,
        timezone: users.timezone,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, userId));
    return u;
  }

  /** People can change their own name and phone. Email and time zone go through the academy. */
  async updateProfile(
    userId: string,
    body: { fullName?: string; phone?: string },
  ) {
    await this.db.update(users).set(body).where(eq(users.id, userId));
    return this.profile(userId);
  }

  async changePassword(userId: string, current: string, next: string) {
    const [u] = await this.db
      .select({ hash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId));
    if (!u || !(await bcrypt.compare(current, u.hash)))
      throw new UnauthorizedException('The current password is wrong.');
    await this.db
      .update(users)
      .set({ passwordHash: await hashPassword(next) })
      .where(eq(users.id, userId));
  }

  /**
   * Short cache of each person's current state, so a turned-off sign-in or a
   * role change takes effect within seconds without a query on every request.
   */
  private readonly stateCache = new Map<
    string,
    {
      active: boolean;
      role: string | null;
      areas: string[] | null;
      until: number;
    }
  >();

  private async currentState(userId: string) {
    const hit = this.stateCache.get(userId);
    if (hit && hit.until > Date.now()) return hit;
    const [u] = await this.db
      .select({
        isActive: users.isActive,
        role: users.role,
        areas: users.staffAreas,
      })
      .from(users)
      .where(eq(users.id, userId));
    const state = {
      active: !!u?.isActive,
      role: u?.role ?? null,
      areas: u?.areas ?? null,
      until: Date.now() + 15_000,
    };
    this.stateCache.set(userId, state);
    return state;
  }

  /** Drop the cached state after changing someone's role or sign-in. */
  forget(userId: string) {
    this.stateCache.delete(userId);
  }

  async verify(token: string): Promise<AuthUser> {
    const payload = await this.jwt.verifyAsync<AuthUser & { sub: string }>(
      token,
    );
    const state = await this.currentState(payload.sub);
    // Turned off, or the role changed since sign-in: sign in again.
    if (!state.active || state.role !== payload.role)
      throw new UnauthorizedException();
    return {
      userId: payload.sub,
      role: payload.role,
      fullName: payload.fullName,
      timezone: payload.timezone,
      teacherId: payload.teacherId,
      studentId: payload.studentId,
      // From the database, so a change by an admin applies within seconds.
      areas: areasOf(payload.role, state.areas),
    };
  }
}

/** null = every area (admins, and staff nobody limited). */
export function areasOf(
  role: string,
  stored: string[] | null | undefined,
): StaffArea[] | null {
  if (role !== 'STAFF' || !stored) return null;
  return STAFF_AREAS.filter((a) => stored.includes(a));
}
