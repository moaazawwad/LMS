import { HttpClient, HttpContext, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/api.service';
import { ACADEMY_TZ, dayTime } from '../../core/format';
import { ToastService } from '../../core/toast.service';
import { QUIET } from '../../core/toast.interceptor';

interface MailStatus {
  enabled: boolean;
  mode: 'smtp' | 'memory' | 'off';
  from: string;
  appUrl: string;
  recent: {
    id: string;
    to: string;
    kind: string;
    subject: string;
    status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
    error: string | null;
    createdAt: string;
  }[];
}

const KIND: Record<string, string> = {
  'password-reset': 'Password link',
  'lesson-reminder': 'Lesson reminder',
  invoice: 'New invoice',
  payment: 'Payment received',
  request: 'New request',
  'lesson-cancelled': 'Lesson cancelled',
  'lesson-moved': 'Lesson moved',
  'lesson-declined': 'Request declined',
  'homework-sent': 'Homework sent',
  'homework-checked': 'Homework checked',
  test: 'Test',
};

/** Admin: is email on, what went out lately, and a test email. */
@Component({
  selector: 'app-email-status',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card" aria-labelledby="mail-title">
      <h2 id="mail-title">Email</h2>
      @if (status.value(); as s) {
        @if (s.enabled) {
          <p class="notice ok" role="status">
            <span
              >Email is on. Messages go out from <strong>{{ s.from }}</strong
              >; links open {{ s.appUrl }}.</span
            >
          </p>
        } @else {
          <p class="notice warn" role="status">
            <span>
              Email is off: nothing is sent yet. To turn it on, add the email account's settings to
              the server (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM and APP_URL; the
              README says how) and restart it.
            </span>
          </p>
        }
        <p class="muted small">
          Sent automatically: a link when someone forgets their password, a reminder about an hour
          before each lesson (student and teacher), each new invoice and payment to the student,
          cancelled and moved lessons, answers to requests, new requests to the staff, and homework
          sent and checked.
        </p>

        <form class="row" (ngSubmit)="test()">
          <div class="field grow">
            <label for="mail-to">Send a test email to</label>
            <input id="mail-to" name="to" type="email" required [(ngModel)]="to" />
          </div>
          <button type="submit" class="btn" [disabled]="busy() || !to.trim()">
            {{ busy() ? 'Sending…' : 'Send test' }}
          </button>
        </form>

        <div class="table-wrap">
          <table class="data" style="min-width: 600px" aria-label="Latest emails">
            <thead>
              <tr>
                <th>When (Cairo)</th>
                <th>To</th>
                <th>What</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              @for (m of s.recent; track m.id) {
                <tr>
                  <td class="num">{{ when(m.createdAt) }}</td>
                  <td>{{ m.to }}</td>
                  <td>{{ kind(m.kind) }}</td>
                  <td>
                    <span
                      class="chip"
                      [class.ok]="m.status === 'SENT'"
                      [class.danger]="m.status === 'FAILED'"
                      >{{ statusText(m.status) }}</span
                    >
                    @if (m.error) {
                      <span class="sub">{{ m.error }}</span>
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="4" class="empty">No emails yet.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <p class="muted">
          {{ status.error() ? 'Could not load the email settings.' : 'Loading…' }}
        </p>
      }
    </section>
  `,
  styles: `
    h2,
    p {
      margin: 0;
    }
    .small {
      font-size: 13px;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: flex-end;
    }
    .grow {
      flex: 1 1 240px;
    }
    .sub {
      display: block;
      font-size: 12px;
      color: var(--danger);
    }
  `,
})
export class EmailStatus {
  private readonly http = inject(HttpClient);
  protected readonly status = httpResource<MailStatus>(() => '/api/mail');
  protected to = '';
  protected readonly busy = signal(false);
  private readonly toast = inject(ToastService);

  protected when(iso: string) {
    return dayTime(iso, ACADEMY_TZ);
  }
  protected kind(k: string) {
    return KIND[k] ?? k;
  }
  protected statusText(s: MailStatus['recent'][number]['status']) {
    return { PENDING: 'waiting', SENT: 'sent', FAILED: 'failed', SKIPPED: 'not sent (email off)' }[
      s
    ];
  }

  protected async test() {
    this.busy.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<{ status: string; error: string | null }>(
          '/api/mail/test',
          { to: this.to.trim() },
          // this page says itself whether it went out
          { context: new HttpContext().set(QUIET, true) },
        ),
      );
      if (res.status === 'SENT')
        this.toast.success(`Sent to ${this.to.trim()}. Check that inbox (and spam).`);
      else
        this.toast.error(
          res.status === 'SKIPPED'
            ? 'Not sent: email is off on the server.'
            : `Not sent yet: ${res.error ?? 'the mail server did not accept it'}. It will be tried again.`,
        );
      this.status.reload();
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
