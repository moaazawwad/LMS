import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Headers,
  HttpStatus,
  Inject,
  Ip,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import type { Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import {
  Area,
  type AuthUser,
  CurrentUser,
  Public,
  Roles,
} from '../common/auth-user.js';
import { DB, type Db } from '../db/db.module.js';
import { applications, applicationStatusEnum, users } from '../db/schema.js';
import { appUrl, MailService } from '../mail/mail.service.js';
import { noticeEmail } from '../mail/templates.js';

type Status = (typeof applicationStatusEnum.enumValues)[number];

/** What the website form sends. Every field but name and email is optional. */
class ApplyDto {
  @IsString() @MinLength(2) @MaxLength(120) fullName: string;
  @IsEmail() @MaxLength(200) email: string;
  @IsOptional() @IsString() @MaxLength(60) phone?: string;
  @IsOptional() @IsString() @MaxLength(80) country?: string;
  @IsOptional() @IsString() @MaxLength(60) timezone?: string;
  @IsOptional() @IsString() @MaxLength(120) curriculum?: string;
  @IsOptional() @IsString() @MaxLength(500) preferredTimes?: string;
  @IsOptional() @IsString() @MaxLength(60) studentAge?: string;
  @IsOptional() @IsString() @MaxLength(60) level?: string;
  @IsOptional() @IsString() @MaxLength(2000) message?: string;
  @IsOptional() @IsString() @MaxLength(500) source?: string;
  @IsOptional() @IsString() @MaxLength(500) utm?: string;
  /** a plain HTML form can ask to come back to this page (on the academy's site) */
  @IsOptional() @IsString() @MaxLength(500) redirect?: string;
  /** left empty by people; bots fill it in */
  @IsOptional() @IsString() @MaxLength(500) website?: string;
}

class ListQuery {
  @IsOptional() @IsIn(applicationStatusEnum.enumValues) status?: Status;
}

class UpdateDto {
  @IsOptional() @IsIn(applicationStatusEnum.enumValues) status?: Status;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  /** set when they became a student */
  @IsOptional() @IsUUID() studentId?: string;
}

/** Applications per address in a window, to keep floods out. */
const LIMIT = { perAddress: 5, windowMs: 10 * 60_000 };

/**
 * The website's server forwards each form with this key (env APPLICATIONS_KEY),
 * so all its requests come from one address: a matching key skips the per-address
 * limit (the website keeps its own). No key set means no bypass.
 */
export function siteKeyMatches(given?: string, env = process.env): boolean {
  const want = env.APPLICATIONS_KEY?.trim();
  if (!want || !given) return false;
  const h = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(h(given.trim()), h(want));
}

/** The academy's own sites, from CORS_ORIGINS: where a form may redirect back to. */
function allowedOrigins(env = process.env): string[] {
  return (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * Website applications. The website posts to /api/public/applications (JSON
 * or a plain form); staff see them under Requests, follow up and convert them.
 */
@ApiTags('Website applications')
@Controller()
export class ApplicationsController {
  private readonly recent = new Map<string, number[]>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  @Public()
  @Post('public/applications')
  @HttpCode(201)
  async apply(
    @Body() body: ApplyDto,
    @Ip() ip: string,
    @Headers('x-site-key') siteKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const back = this.redirectTo(body.redirect);
    // Bots fill the hidden field: thank them and keep nothing.
    if (body.website?.trim()) return this.done(res, back);
    if (!siteKeyMatches(siteKey)) this.limit(ip);
    const clean = (v?: string) => v?.replace(/\s+/g, ' ').trim() || null;
    const [row] = await this.db
      .insert(applications)
      .values({
        fullName: clean(body.fullName)!,
        email: body.email.trim().toLowerCase(),
        phone: clean(body.phone),
        country: clean(body.country),
        timezone: clean(body.timezone),
        curriculum: clean(body.curriculum),
        preferredTimes: body.preferredTimes?.trim() || null,
        studentAge: clean(body.studentAge),
        level: clean(body.level),
        message: body.message?.trim() || null,
        source: clean(body.source),
        utm: clean(body.utm),
      })
      .returning();
    await this.audit.record(this.db, null, {
      action: 'application.create',
      entityType: 'application',
      entityId: row.id,
      summary: `New application from the website: ${row.fullName} (${row.email})${row.curriculum ? ` · ${row.curriculum}` : ''}`,
    });
    // Tell the admins (sent when email is set up).
    const admins = await this.db
      .select({ email: users.email, name: users.fullName })
      .from(users)
      .where(and(eq(users.role, 'ADMIN'), eq(users.isActive, true)));
    for (const a of admins)
      await this.mail.enqueue(
        this.db,
        a.email,
        'application',
        noticeEmail({
          name: a.name,
          title: 'New application from the website',
          lines: [
            `${row.fullName} (${row.email}${row.phone ? `, ${row.phone}` : ''}) applied${row.curriculum ? ` for ${row.curriculum}` : ''}.`,
            ...(row.preferredTimes
              ? [`Times that suit them: ${row.preferredTimes}`]
              : []),
          ],
          button: 'Open the applications',
          link: `${appUrl()}/admin/requests?tab=applications`,
        }),
      );
    this.mail.sendSoon();
    return this.done(res, back);
  }

  private redirectTo(url?: string): string | null {
    if (!url) return null;
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) return null;
      return allowedOrigins().includes(u.origin) ? u.toString() : null;
    } catch {
      return null;
    }
  }

  private done(res: Response, back: string | null) {
    if (back) {
      res.redirect(303, back);
      return;
    }
    return { ok: true };
  }

  private limit(ip: string, now = Date.now()) {
    const times = (this.recent.get(ip) ?? []).filter(
      (t) => now - t < LIMIT.windowMs,
    );
    if (times.length >= LIMIT.perAddress)
      throw new HttpException(
        'Too many applications from here. Please try again later or write to us.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    times.push(now);
    this.recent.set(ip, times);
    if (this.recent.size > 10_000) this.recent.clear();
  }

  @Get('applications')
  @Roles('ADMIN', 'STAFF')
  @Area('lessons')
  list(@Query() q: ListQuery) {
    const where: SQL[] = [];
    if (q.status) where.push(eq(applications.status, q.status));
    return this.db
      .select()
      .from(applications)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(applications.createdAt))
      .limit(300);
  }

  @Get('applications/summary')
  @Roles('ADMIN', 'STAFF')
  async summary() {
    const [row] = await this.db
      .select({ n: count() })
      .from(applications)
      .where(eq(applications.status, 'NEW'));
    return { new: row?.n ?? 0 };
  }

  @Patch('applications/:id')
  @Roles('ADMIN', 'STAFF')
  @Area('lessons')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDto,
  ) {
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(applications)
        .where(eq(applications.id, id))
        .for('update');
      if (!before) throw new NotFoundException();
      const [row] = await tx
        .update(applications)
        .set({
          ...(body.status ? { status: body.status } : {}),
          ...(body.notes !== undefined
            ? { notes: body.notes.trim() || null }
            : {}),
          ...(body.studentId ? { studentId: body.studentId } : {}),
          handledAt: new Date(),
          handledById: user.userId,
        })
        .where(eq(applications.id, id))
        .returning();
      const label = (s: string) =>
        s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ');
      await this.audit.record(tx, user, {
        action: 'application.update',
        entityType: 'application',
        entityId: id,
        summary:
          body.status && body.status !== before.status
            ? `Application of ${before.fullName}: ${label(before.status)} → ${label(body.status)}`
            : `Updated the notes on ${before.fullName}'s application`,
        before: { status: before.status, notes: before.notes },
        after: { status: row.status, notes: row.notes },
      });
      return row;
    });
  }
}
