import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { dayTime, money, time } from '../core/format';
import { type InvoiceDetail, PAYMENT_METHOD_LABEL } from '../core/models';
import { BRAND } from '../shared/brand';
import { VoidInvoiceDialog } from '../shared/void-invoice-dialog';
import { PageLog } from '../shared/page-log';
import { PayInvoiceDialog, type PayTarget } from '../shared/pay-invoice-dialog';

const STATUS: Record<InvoiceDetail['status'], string> = { OPEN: 'Due', PAID: 'Paid', VOID: 'Void' };

/** One invoice: who, what course, the charges, and every lesson it covers. */
@Component({
  selector: 'app-invoice',
  imports: [PageLog, RouterLink, VoidInvoiceDialog, PayInvoiceDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (invoice.value(); as inv) {
      <div class="page">
        <nav aria-label="Breadcrumb" class="muted">
          <a [routerLink]="back">Invoices</a> / {{ inv.number }}
        </nav>
        @if (inv.voided; as v) {
          <div class="notice warn voided" role="note">
            <span>
              <strong>This invoice is void{{ v.at ? ' since ' + date(v.at) : '' }}.</strong>
              @if (v.by) {
                Voided by {{ v.by }}.
              }
              @if (v.reason) {
                <span class="why">Reason: {{ v.reason }}</span>
              }
              @if (inv.replacedBy; as r) {
                <span class="why"
                  >Replaced by <a [routerLink]="[back, r.id]">{{ r.number }}</a
                  >.</span
                >
              } @else if (!isStudent) {
                <span class="why">No new invoice was issued for this cycle.</span>
              }
            </span>
          </div>
        }
        @if (inv.status === 'OPEN' && inv.totalCents > 0) {
          @if (inv.standing.onHold) {
            <p class="notice danger standing" data-testid="standing">
              <span>
                <strong>Lessons are on hold for this invoice.</strong>
                {{ inv.standing.lessonsRemoved }} upcoming
                {{ inv.standing.lessonsRemoved === 1 ? 'lesson was' : 'lessons were' }} removed
                after {{ inv.standing.lessonsTaken }} taken without payment.
                {{
                  isStaff
                    ? 'Recording the payment brings back the lessons still ahead; the ones already missed come off the next invoice.'
                    : 'They come back as soon as the invoice is paid.'
                }}
              </span>
            </p>
          } @else if (inv.standing.overdue) {
            <p class="notice warn standing" data-testid="standing">
              <span>
                <strong>This invoice was due on {{ day(inv.standing.dueDate) }}.</strong>
                @if (inv.standing.lessonsLeftBeforeHold > 0) {
                  {{ inv.standing.lessonsLeftBeforeHold }} more
                  {{ inv.standing.lessonsLeftBeforeHold === 1 ? 'lesson' : 'lessons' }} can be taken
                  before paying; after that the remaining lessons stop until it is paid.
                } @else {
                  The lessons of grace are used: the remaining lessons stop until it is paid.
                }
              </span>
            </p>
          }
        }
        <article class="sheet" aria-labelledby="inv-title">
          <header class="band">
            <img
              class="brand"
              src="brand/brightverse-logo.svg"
              [alt]="brand.name"
              width="190"
              height="48"
            />
            <div class="title">
              <h1 id="inv-title"><span class="kicker">Invoice </span>{{ inv.number }}</h1>
              <span
                class="pill"
                [class.paid]="inv.status === 'PAID'"
                [class.void]="inv.status === 'VOID'"
                >{{ status[inv.status] }}</span
              >
            </div>
          </header>
          @if (inv.replaces; as r) {
            <p class="muted small replaces">
              Replaces <a [routerLink]="[back, r.id]">{{ r.number }}</a
              >, which is void.
            </p>
          }

          <section class="facts">
            <div>
              <h2>Billed to</h2>
              <p class="strong">{{ inv.student.name }}</p>
              <p class="muted">{{ inv.student.email }}</p>
              <p class="muted">Time zone: {{ inv.student.timezone }}</p>
            </div>
            <div>
              <h2>Course</h2>
              <p class="strong">{{ inv.curriculum }}</p>
              <p>{{ inv.plan }} plan · {{ inv.lessonMinutes }}-minute lessons</p>
              @if (inv.teacher) {
                <p>Teacher: {{ inv.teacher }}</p>
              }
            </div>
            <div>
              <h2>Details</h2>
              <dl>
                <dt>Issued</dt>
                <dd>{{ date(inv.issuedAt) }}</dd>
                <dt>Period</dt>
                <dd>{{ day(inv.cycle.startDate) }} – {{ day(inv.cycle.endDate) }}</dd>
                <dt>Cycle</dt>
                <dd>{{ inv.cycle.index }} (28 days, paid in advance)</dd>
                @if (inv.paidAt) {
                  <dt>Paid on</dt>
                  <dd>
                    {{ inv.payment?.receivedOn ? day(inv.payment!.receivedOn!) : date(inv.paidAt) }}
                  </dd>
                }
                @if (inv.payment; as p) {
                  @if (p.method) {
                    <dt>Paid by</dt>
                    <dd>{{ methodLabel[p.method] }}</dd>
                  }
                  @if (p.reference) {
                    <dt>Reference</dt>
                    <dd>{{ p.reference }}</dd>
                  }
                }
              </dl>
            </div>
          </section>

          <table class="lines" aria-label="Charges">
            <thead>
              <tr>
                <th>Description</th>
                <th class="r">Qty</th>
                <th class="r">Unit price</th>
                <th class="r">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <span class="strong">Lessons in this cycle</span>
                  <span class="sub"
                    >{{ inv.lessonsCount }} × {{ inv.lessonMinutes }} min ·
                    {{ day(inv.cycle.startDate) }} – {{ day(inv.cycle.endDate) }}</span
                  >
                </td>
                <td class="r">{{ inv.lessonsCount }}</td>
                <td class="r">{{ m(inv.priceCents) }}</td>
                <td class="r">{{ m(inv.lessonsCount * inv.priceCents) }}</td>
              </tr>
              @if (inv.extraCount) {
                <tr>
                  <td>
                    <span class="strong">Extra lessons</span>
                    <span class="sub">{{ extraDates(inv) }}</span>
                  </td>
                  <td class="r">{{ inv.extraCount }}</td>
                  <td class="r">{{ m(inv.priceCents) }}</td>
                  <td class="r">{{ m(inv.extraCount * inv.priceCents) }}</td>
                </tr>
              }
              @if (inv.creditsCount) {
                <tr>
                  <td>
                    <span class="strong">Credit for cancelled lessons</span>
                    <span class="sub">{{ creditDates(inv) }}</span>
                  </td>
                  <td class="r">−{{ inv.creditsCount }}</td>
                  <td class="r">{{ m(inv.priceCents) }}</td>
                  <td class="r">−{{ m(inv.creditsCount * inv.priceCents) }}</td>
                </tr>
              }
            </tbody>
          </table>

          <div class="totals">
            <dl>
              <dt>Subtotal</dt>
              <dd>{{ m((inv.lessonsCount + inv.extraCount) * inv.priceCents) }}</dd>
              @if (inv.creditsCount) {
                <dt>Credits</dt>
                <dd>−{{ m(inv.creditsCount * inv.priceCents) }}</dd>
              }
              <dt class="grand">{{ inv.status === 'PAID' ? 'Total paid' : 'Total due' }}</dt>
              <dd class="grand">{{ m(inv.totalCents) }}</dd>
            </dl>
          </div>

          @if (inv.paymentInstructions) {
            <section class="how" aria-labelledby="inv-pay">
              <h2 id="inv-pay">How to pay</h2>
              <p class="pre">
                @for (part of linkParts(inv.paymentInstructions); track $index) {
                  @if (part.url) {
                    <a [href]="part.text" target="_blank" rel="noopener">{{ part.text }}</a>
                  } @else {
                    {{ part.text }}
                  }
                }
              </p>
            </section>
          }

          <section aria-labelledby="inv-lessons">
            <h2 id="inv-lessons" class="section-title">
              Lesson schedule <span class="muted">({{ inv.student.timezone }} time)</span>
            </h2>
            <table class="schedule">
              <thead>
                <tr>
                  <th class="n">#</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                @for (l of inv.lessons; track l.startsAt; let i = $index) {
                  <tr [class.off]="l.status === 'CANCELLED'">
                    <td class="n">{{ i + 1 }}</td>
                    <td>{{ longDay(l.startsAt) }}</td>
                    <td>{{ clock(l.startsAt) }}</td>
                    <td>{{ lessonState(l) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </section>

          <footer class="foot">
            <span>{{ brand.name }}</span>
            <span>Thank you for learning with us.</span>
          </footer>
        </article>
        <div class="actions">
          @if (isStaff && inv.status === 'OPEN') {
            <button type="button" class="btn primary" (click)="open('pay', inv)">Mark paid</button>
          }
          @if (isAdmin && inv.status === 'PAID') {
            <button type="button" class="btn" (click)="open('unpay', inv)">
              Take the payment back
            </button>
          }
          @if (isAdmin && inv.status !== 'VOID') {
            <button type="button" class="btn danger" (click)="voiding.set(inv)">
              Void invoice
            </button>
          }
        </div>
        @if (isStaff && inv.payment; as p) {
          @if (p.recordedBy || p.note) {
            <p class="muted small recorded">
              Payment recorded{{ p.recordedBy ? ' by ' + p.recordedBy : ''
              }}{{ p.note ? ' · ' + p.note : '' }}
            </p>
          }
        }
        @if (isStaff) {
          <app-page-log entityType="invoice" [entityId]="inv.id" />
        }
      </div>
    } @else {
      <p class="empty">{{ invoice.error() ? 'Invoice not found.' : 'Loading…' }}</p>
    }
    <app-pay-invoice-dialog
      [invoice]="paying()"
      [mode]="payMode()"
      (closed)="paying.set(null)"
      (done)="invoice.reload()"
    />
    <app-void-invoice-dialog
      [invoice]="voiding()"
      (closed)="voiding.set(null)"
      (done)="voided($event)"
    />
  `,
  styles: `
    .standing,
    .recorded {
      max-width: 860px;
    }
    .page {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .sheet {
      max-width: 960px;
      width: 100%;
      background: var(--surface, #fff);
      border: 1px solid var(--border);
      border-radius: 14px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      gap: 28px;
      padding: 0 44px 32px;
      box-shadow: 0 1px 2px rgb(0 0 0 / 4%);
    }
    .voided {
      max-width: 960px;
      margin: 0;
    }
    .voided > span {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .band {
      margin: 0 -44px;
      padding: 28px 44px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      border-bottom: 4px solid var(--accent);
      background: linear-gradient(0deg, var(--accent-tint), var(--accent-tint));
    }
    .brand {
      display: block;
      height: 48px;
      width: auto;
    }
    .title {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
    }
    .kicker {
      display: block;
      margin-bottom: 4px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--primary);
    }
    h1 {
      margin: 0;
      font-size: 30px;
      letter-spacing: -0.01em;
    }
    .pill {
      font-size: 13px;
      font-weight: 700;
      padding: 4px 12px;
      border-radius: 999px;
      background: var(--danger-tint);
      color: var(--danger);
    }
    .pill.paid {
      background: #e3f1ea;
      color: var(--primary);
    }
    .pill.void {
      background: #eee;
      color: var(--muted);
    }
    .replaces {
      margin: -16px 0 0;
    }
    .facts {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 24px;
    }
    .facts h2,
    .section-title {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
      margin: 0 0 8px;
    }
    .section-title .muted {
      text-transform: none;
      letter-spacing: 0;
      font-weight: 500;
    }
    .facts p {
      margin: 0 0 3px;
      font-size: 15px;
    }
    .facts dl {
      margin: 0;
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 12px;
      font-size: 15px;
    }
    dt {
      color: var(--muted);
    }
    dd {
      margin: 0;
    }
    .strong {
      font-weight: 700;
    }
    .muted {
      color: var(--muted);
    }
    .small {
      font-size: 13px;
    }
    .lines,
    .schedule {
      width: 100%;
      border-collapse: collapse;
      font-size: 15px;
    }
    .lines th,
    .schedule th {
      text-align: left;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      padding: 10px 12px;
      background: var(--ground, #f6f6f2);
    }
    .lines td {
      padding: 14px 12px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    .schedule td {
      padding: 9px 12px;
      border-bottom: 1px solid var(--border);
    }
    .schedule .n {
      width: 40px;
      color: var(--muted);
    }
    .schedule tr.off td {
      color: var(--muted);
      text-decoration: line-through;
    }
    .r {
      text-align: right !important;
      white-space: nowrap;
    }
    .sub {
      display: block;
      font-size: 13px;
      color: var(--muted);
      margin-top: 2px;
    }
    .totals {
      display: flex;
      justify-content: flex-end;
      margin-top: -12px;
    }
    .totals dl {
      margin: 0;
      display: grid;
      grid-template-columns: auto auto;
      gap: 8px 0;
      min-width: 320px;
      font-size: 15px;
    }
    .totals dd {
      padding-left: 40px;
    }
    .totals dd {
      text-align: right;
    }
    .totals .grand {
      font-size: 20px;
      font-weight: 800;
      color: var(--ink);
      padding-top: 10px;
      border-top: 2px solid var(--ink);
    }
    .how {
      background: var(--accent-tint);
      border-radius: 10px;
      padding: 16px 18px;
    }
    .how h2 {
      font-size: 15px;
      margin: 0 0 6px;
    }
    .how .pre {
      white-space: pre-line;
      margin: 0;
    }
    .foot {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 8px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
      font-size: 13px;
      color: var(--muted);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    @media (max-width: 720px) {
      .sheet {
        padding: 0 18px 24px;
        gap: 22px;
      }
      .band {
        margin: 0 -18px;
        padding: 20px 18px;
      }
      .title {
        align-items: flex-start;
      }
      .facts {
        grid-template-columns: 1fr;
        gap: 16px;
      }
      .lines th:nth-child(3),
      .lines td:nth-child(3) {
        display: none;
      }
      .totals dl {
        min-width: 0;
        width: 100%;
      }
    }
  `,
})
export class InvoicePage {
  protected readonly brand = BRAND;
  readonly id = input.required<string>();
  private readonly router = inject(Router);
  private readonly role = inject(AuthService).user()?.role;
  protected readonly isStudent = this.role === 'STUDENT';
  protected readonly isStaff = this.role === 'ADMIN' || this.role === 'STAFF';
  protected readonly isAdmin = this.role === 'ADMIN';
  protected readonly back = this.isStudent ? '/student/invoices' : '/admin/invoices';
  protected readonly voiding = signal<InvoiceDetail | null>(null);
  protected readonly paying = signal<PayTarget | null>(null);
  protected readonly payMode = signal<'pay' | 'unpay'>('pay');
  protected readonly methodLabel = PAYMENT_METHOD_LABEL;
  protected readonly invoice = httpResource<InvoiceDetail>(() => `/api/invoices/${this.id()}`);
  protected readonly status = STATUS;

  protected m(cents: number) {
    return money(cents, this.invoice.value()?.currency ?? 'USD');
  }
  /** "Oct 20, 2026" on the student's clock: invoices need the year. */
  protected date(iso: string) {
    const timeZone = this.invoice.value()?.student.timezone ?? 'UTC';
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(iso));
  }
  /** "Sun, Nov 8, 2026" on the student's clock */
  protected longDay(iso: string) {
    const timeZone = this.invoice.value()?.student.timezone ?? 'UTC';
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(iso));
  }
  protected clock(iso: string) {
    return time(iso, this.invoice.value()?.student.timezone ?? 'UTC');
  }
  /** "Nov 2, 2026" for a plain date (YYYY-MM-DD) */
  protected day(date: string) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(`${date}T12:00:00Z`));
  }
  protected lessonState(l: InvoiceDetail['lessons'][number]) {
    const label: Record<string, string> = {
      SCHEDULED: 'Scheduled',
      COMPLETED: 'Done',
      CANCELLED: l.countedAsTaken ? 'Cancelled (counted)' : 'Cancelled',
    };
    return (
      (label[l.status] ?? l.status.charAt(0) + l.status.slice(1).toLowerCase()) +
      (l.type === 'EXTRA' ? ' · extra' : '')
    );
  }
  protected when(iso: string) {
    return dayTime(iso, this.invoice.value()?.student.timezone ?? 'UTC');
  }
  protected extraDates(inv: InvoiceDetail) {
    return inv.extras.map((e) => this.when(e.lessonStartsAt)).join(', ');
  }

  protected creditDates(inv: InvoiceDetail) {
    return inv.credits.map((c) => this.when(c.lessonStartsAt)).join(', ');
  }
  /** Payment links in the instructions become clickable (http and https only). */
  protected linkParts(text: string) {
    return text
      .split(/(https?:\/\/[^\s<>"]+)/g)
      .filter(Boolean)
      .map((t) => ({ text: t, url: /^https?:\/\//.test(t) }));
  }

  /** Record a payment, or (admins) take one back. */
  protected open(mode: 'pay' | 'unpay', inv: InvoiceDetail) {
    this.payMode.set(mode);
    this.paying.set({
      id: inv.id,
      number: inv.number,
      totalCents: inv.totalCents,
      currency: inv.currency,
      studentName: inv.student.name,
      onHold: inv.standing.onHold,
    });
  }

  /** After voiding: open the new invoice when there is one. */
  protected voided(replacement: { id: string; number: string } | null) {
    this.voiding.set(null);
    if (replacement) void this.router.navigate([this.back, replacement.id]);
    else this.invoice.reload();
  }
}
