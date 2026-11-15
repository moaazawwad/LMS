import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, asc, desc, eq, lt } from 'drizzle-orm';
import nodemailer, { type Transporter } from 'nodemailer';
import { DB, type Db, type Tx } from '../db/db.module.js';
import { emailOutbox } from '../db/schema.js';
import type { EmailContent } from './templates.js';

const MAX_ATTEMPTS = 3;

export interface MailSettings {
  /** smtp: a real mail server; memory: kept in this process (tests); off: written to the log only */
  mode: 'smtp' | 'memory' | 'off';
  from: string;
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
}

/** From SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM. */
export function mailSettingsFromEnv(
  env: Record<string, string | undefined>,
): MailSettings {
  const from =
    env.MAIL_FROM?.trim() ||
    'Brightverse Academy <no-reply@brightverseacademy.com>';
  if (env.MAIL_TRANSPORT === 'memory') return { mode: 'memory', from };
  const host = env.SMTP_HOST?.trim();
  if (!host) return { mode: 'off', from };
  return {
    mode: 'smtp',
    from,
    host,
    port: Number(env.SMTP_PORT) || 587,
    user: env.SMTP_USER?.trim(),
    pass: env.SMTP_PASS,
  };
}

/** The address people open links at, without a trailing slash. */
export function appUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  return (env.APP_URL?.trim() || 'http://localhost:4200').replace(/\/+$/, '');
}

/**
 * Sends the academy's emails. Callers add a message to the outbox inside
 * their transaction; a job sends what is waiting every minute (and right
 * away when asked). Without SMTP settings nothing is sent: messages are
 * marked SKIPPED so the admin can see email is off.
 */
@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly log = new Logger('Mail');
  readonly settings = mailSettingsFromEnv(process.env);
  private readonly transport: Transporter | null =
    this.settings.mode === 'smtp'
      ? nodemailer.createTransport({
          host: this.settings.host,
          port: this.settings.port,
          secure: this.settings.port === 465,
          auth: this.settings.user
            ? { user: this.settings.user, pass: this.settings.pass }
            : undefined,
          disableFileAccess: true,
          disableUrlAccess: true,
        })
      : null;
  /** messages "sent" in memory mode (tests) */
  readonly sent: {
    to: string;
    subject: string;
    text: string;
    html: string;
    kind: string;
  }[] = [];
  private flushing: Promise<number> | null = null;
  private again: Promise<number> | null = null;

  constructor(@Inject(DB) private readonly db: Db) {}

  onModuleDestroy() {
    this.transport?.close();
  }

  get enabled() {
    return this.settings.mode !== 'off';
  }

  /** Add to the outbox, in the caller's transaction. */
  async enqueue(tx: Tx | Db, to: string, kind: string, content: EmailContent) {
    await tx.insert(emailOutbox).values({
      to,
      kind,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
  }

  /** Send what is waiting now, after the caller's transaction committed. */
  sendSoon() {
    setTimeout(
      () =>
        void this.flush().catch((err: Error) =>
          this.log.warn(`Sending failed: ${err.message}`),
        ),
      0,
    );
  }

  @Cron(CronExpression.EVERY_MINUTE)
  flush(): Promise<number> {
    // One run at a time. A call during a run may have new emails that run
    // didn't see, so it gets one more run right after.
    if (this.flushing) {
      this.again ??= this.flushing.then(() => {
        this.again = null;
        return this.flush();
      });
      return this.again;
    }
    this.flushing = this.flushOnce().finally(() => (this.flushing = null));
    return this.flushing;
  }

  private async flushOnce(): Promise<number> {
    const waiting = await this.db
      .select()
      .from(emailOutbox)
      .where(
        and(
          eq(emailOutbox.status, 'PENDING'),
          lt(emailOutbox.attempts, MAX_ATTEMPTS),
        ),
      )
      .orderBy(asc(emailOutbox.createdAt))
      .limit(50);
    let sent = 0;
    for (const m of waiting) {
      if (this.settings.mode === 'off') {
        this.log.log(
          `Email is off (no SMTP_HOST): not sent "${m.subject}" to ${m.to}`,
        );
        await this.db
          .update(emailOutbox)
          .set({ status: 'SKIPPED', text: null, html: null })
          .where(eq(emailOutbox.id, m.id));
        continue;
      }
      try {
        if (this.settings.mode === 'memory')
          this.sent.push({
            to: m.to,
            subject: m.subject,
            text: m.text ?? '',
            html: m.html ?? '',
            kind: m.kind,
          });
        else
          await this.transport!.sendMail({
            from: this.settings.from,
            to: m.to,
            subject: m.subject,
            text: m.text ?? undefined,
            html: m.html ?? undefined,
          });
        await this.db
          .update(emailOutbox)
          .set({
            status: 'SENT',
            sentAt: new Date(),
            attempts: m.attempts + 1,
            text: null,
            html: null,
            error: null,
          })
          .where(eq(emailOutbox.id, m.id));
        sent++;
      } catch (err) {
        const attempts = m.attempts + 1;
        const failed = attempts >= MAX_ATTEMPTS;
        this.log.warn(
          `Could not send "${m.subject}" to ${m.to} (try ${attempts}): ${(err as Error).message}`,
        );
        await this.db
          .update(emailOutbox)
          .set({
            attempts,
            error: (err as Error).message.slice(0, 500),
            ...(failed
              ? { status: 'FAILED' as const, text: null, html: null }
              : {}),
          })
          .where(eq(emailOutbox.id, m.id));
      }
    }
    return sent;
  }

  /** For the admin: is email on, and the latest messages. */
  async status() {
    const recent = await this.db
      .select({
        id: emailOutbox.id,
        to: emailOutbox.to,
        kind: emailOutbox.kind,
        subject: emailOutbox.subject,
        status: emailOutbox.status,
        error: emailOutbox.error,
        createdAt: emailOutbox.createdAt,
        sentAt: emailOutbox.sentAt,
      })
      .from(emailOutbox)
      .orderBy(desc(emailOutbox.createdAt))
      .limit(30);
    return {
      enabled: this.enabled,
      mode: this.settings.mode,
      from: this.settings.from,
      appUrl: appUrl(),
      recent,
    };
  }
}
