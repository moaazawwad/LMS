import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ACADEMY_TZ, localDate, money, monthEnd, shiftMonth } from '../../core/format';
import type { Payout, TeacherLessonsRow } from '../../core/models';
import { LevelRates } from './level-rates';
import { PayoutDialog, type PayoutAction } from './payout-dialog';
import { ToastService } from '../../core/toast.service';

/**
 * Lessons per teacher for a month (Cairo), to work out pay. A lesson counts
 * for the teacher when it was held, or when they were there and the student
 * was not; it does not when they did not come or nobody came.
 */
@Component({
  selector: 'app-teacher-pay',
  imports: [PayoutDialog, LevelRates],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isAdmin) {
      <app-level-rates (changedRates)="rows.reload()" />
    }
    <section class="card flush" aria-labelledby="pay-title">
      <div class="card-head">
        <div>
          <h2 id="pay-title">Lessons to pay</h2>
          <span class="muted small"
            >Held, or the student was absent · {{ from() }} to {{ to() }}, Cairo</span
          >
        </div>
        <div class="nav">
          <button
            type="button"
            class="btn small"
            aria-label="Previous month"
            (click)="month.set(shift(month(), -1))"
          >
            ‹
          </button>
          <span class="m" aria-live="polite">{{ monthName() }}</span>
          <button
            type="button"
            class="btn small"
            aria-label="Next month"
            [disabled]="month() >= thisMonth"
            (click)="month.set(shift(month(), 1))"
          >
            ›
          </button>
        </div>
      </div>
      <div class="table-wrap">
        <table
          class="data"
          [style.min-width.px]="showPay() ? 1000 : 640"
          aria-label="Lessons to pay"
        >
          <thead>
            <tr>
              <th>Teacher</th>
              <th class="r">Held</th>
              <th class="r">Student absent</th>
              <th class="r">Paid lessons</th>
              <th class="r">Hours</th>
              <th class="r">Not paid</th>
              <th class="r">To check</th>
              @if (showPay()) {
                <th class="r">Rate / hour</th>
                <th class="r">Pay</th>
                <th>Paid?</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (r of rows.value(); track r.teacherId) {
              <tr>
                <td>
                  <strong>{{ r.name }}</strong>
                </td>
                <td class="r num">{{ r.held }}</td>
                <td class="r num">{{ r.studentAbsent }}</td>
                <td class="r num">
                  <strong>{{ r.paid }}</strong>
                </td>
                <td class="r num">{{ hours(r.paidMinutes) }}</td>
                <td class="r num">{{ r.notPaid }}</td>
                <td class="r num" [class.warn]="r.toCheck > 0">{{ r.toCheck }}</td>
                @if (showPay()) {
                  <td class="r num muted">
                    {{ r.rateCents == null ? 'not set' : m(r.rateCents, r.currency) }}
                  </td>
                  <td class="r num">
                    <strong>{{ r.payCents == null ? '—' : m(r.payCents, r.currency) }}</strong>
                  </td>
                  <td class="paid">
                    @if (payoutOf(r.teacherId); as p) {
                      <span class="chip ok">paid {{ shortDate(p.paidAt) }}</span>
                      <span class="sub">{{ m(p.amountCents, p.currency) }}</span>
                      @if (p.minutes !== r.paidMinutes) {
                        <span class="sub changed"
                          >Lessons changed since: paid for {{ hours(p.minutes) }} h, now
                          {{ hours(r.paidMinutes) }} h</span
                        >
                      }
                      <button
                        type="button"
                        class="linkish"
                        [attr.aria-label]="'Undo ' + r.name + ' payment'"
                        (click)="undo(p)"
                      >
                        Undo
                      </button>
                    } @else if (r.payCents) {
                      <button
                        type="button"
                        class="btn small primary"
                        [attr.aria-label]="'Mark ' + r.name + ' paid'"
                        (click)="pay(r)"
                      >
                        Mark paid
                      </button>
                    } @else {
                      <span class="muted">—</span>
                    }
                  </td>
                }
              </tr>
            } @empty {
              <tr>
                <td [attr.colspan]="showPay() ? 10 : 7" class="empty">
                  {{ rows.isLoading() ? 'Loading…' : 'No finished lessons this month.' }}
                </td>
              </tr>
            }
          </tbody>
          @if (rows.value().length > 1) {
            <tfoot>
              <tr>
                <th>All teachers</th>
                <th class="r num">{{ total().held }}</th>
                <th class="r num">{{ total().studentAbsent }}</th>
                <th class="r num">{{ total().paid }}</th>
                <th class="r num">{{ hours(total().paidMinutes) }}</th>
                <th class="r num">{{ total().notPaid }}</th>
                <th class="r num">{{ total().toCheck }}</th>
                @if (showPay()) {
                  <th></th>
                  <th class="r num">{{ payTotal() }}</th>
                  <th class="num">{{ paidTotal() }}</th>
                }
              </tr>
            </tfoot>
          }
        </table>
      </div>
      <p class="foot muted small">
        "To check": the teacher did not enter and the academy has not decided yet. Those are not
        paid until marked as held.
        @if (showPay()) {
          Pay = hours of paid lessons × the rate: the teacher's own rate when set on their page,
          otherwise their level's rate above. "Mark paid" records that you paid the teacher, after
          the month is over.
        }
      </p>
    </section>
    <app-payout-dialog
      [action]="action()"
      (closed)="action.set(null)"
      (done)="afterPayout($event)"
    />
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .card-head {
      flex-wrap: wrap;
      gap: 10px;
    }
    .card-head > div:first-child {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .nav {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .m {
      min-width: 120px;
      text-align: center;
      font-weight: 600;
    }
    td.warn {
      color: var(--warn);
      font-weight: 700;
    }
    .foot {
      margin: 0;
      padding: 12px 18px;
      border-top: 1px solid var(--border);
    }
    .saved {
      margin: 12px 18px 0;
    }
    td.paid {
      white-space: normal;
      min-width: 150px;
    }
    td.paid .chip {
      margin-right: 4px;
    }
    .sub {
      display: block;
      font-size: 12px;
      color: var(--muted);
    }
    .sub.changed {
      color: var(--warn);
      font-weight: 600;
    }
    .linkish {
      padding: 0;
      border: 0;
      background: none;
      font: inherit;
      font-size: 12px;
      color: var(--primary);
      text-decoration: underline;
      cursor: pointer;
    }
  `,
})
export class TeacherPay {
  private readonly api = inject(ApiService);
  protected readonly thisMonth = localDate(new Date(), ACADEMY_TZ).slice(0, 7);
  protected readonly month = linkedSignal(() => this.thisMonth);
  protected readonly shift = shiftMonth;
  protected readonly from = computed(() => `${this.month()}-01`);
  protected readonly to = computed(() => monthEnd(this.month()));
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  private readonly toast = inject(ToastService);
  protected readonly action = signal<PayoutAction | null>(null);
  protected readonly isAdmin = inject(AuthService).user()?.role === 'ADMIN';

  protected readonly rows = httpResource<TeacherLessonsRow[]>(
    () => ({ url: '/api/stats/teacher-lessons', params: { from: this.from(), to: this.to() } }),
    { defaultValue: [] },
  );
  protected readonly total = computed(() =>
    this.rows.value().reduce(
      (t, r) => ({
        held: t.held + r.held,
        studentAbsent: t.studentAbsent + r.studentAbsent,
        paid: t.paid + r.paid,
        paidMinutes: t.paidMinutes + r.paidMinutes,
        notPaid: t.notPaid + r.notPaid,
        toCheck: t.toCheck + r.toCheck,
      }),
      { held: 0, studentAbsent: 0, paid: 0, paidMinutes: 0, notPaid: 0, toCheck: 0 },
    ),
  );
  /** Months already paid, per teacher (admins only). */
  protected readonly payouts = httpResource<Payout[]>(
    () => (this.isAdmin ? { url: '/api/payouts', params: { month: this.month() } } : undefined),
    {
      defaultValue: [],
    },
  );
  protected payoutOf(teacherId: string) {
    return this.payouts.value().find((p) => p.teacherId === teacherId) ?? null;
  }
  protected readonly paidTotal = computed(() => {
    const sums = new Map<string, number>();
    for (const p of this.payouts.value())
      sums.set(p.currency, (sums.get(p.currency) ?? 0) + p.amountCents);
    return [...sums].map(([cur, cents]) => `${money(cents, cur)} paid`).join(' + ') || '';
  });
  /** The API sends pay to admins only. */
  protected readonly showPay = computed(() => this.rows.value().some((r) => 'payCents' in r));
  protected readonly payTotal = computed(() => {
    const sums = new Map<string, number>();
    for (const r of this.rows.value())
      if (r.payCents != null && r.currency)
        sums.set(r.currency, (sums.get(r.currency) ?? 0) + r.payCents);
    return [...sums].map(([cur, cents]) => money(cents, cur)).join(' + ') || '—';
  });
  protected m(cents: number, currency?: string) {
    return money(cents, currency ?? 'EGP');
  }
  protected readonly monthName = computed(() =>
    new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${this.month()}-15T12:00:00Z`),
    ),
  );

  protected shortDate(iso: string) {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: ACADEMY_TZ,
    }).format(new Date(iso));
  }

  protected pay(row: TeacherLessonsRow) {
    this.action.set({ kind: 'pay', row, month: this.month(), monthName: this.monthName() });
  }

  protected undo(payout: Payout) {
    this.action.set({ kind: 'undo', payout, monthName: this.monthName() });
  }

  protected afterPayout(message: string) {
    this.action.set(null);
    this.toast.success(message);
    this.payouts.reload();
    this.rows.reload();
  }

  protected hours(min: number) {
    return (min / 60).toLocaleString('en-US', { maximumFractionDigits: 1 });
  }
}
