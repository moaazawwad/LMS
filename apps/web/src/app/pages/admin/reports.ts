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
import { RouterLink } from '@angular/router';
import { ACADEMY_TZ, localDate, money, shiftMonth } from '../../core/format';
import type { MoneyLine, MonthlyReport } from '../../core/models';
import { PageLog } from '../../shared/page-log';

const monthName = (m: string, style: 'long' | 'short' = 'long') =>
  new Intl.DateTimeFormat('en-US', {
    month: style,
    year: style === 'long' ? 'numeric' : undefined,
    timeZone: 'UTC',
  }).format(new Date(`${m}-15T12:00:00Z`));

/**
 * One month of the academy in numbers (Cairo time): money issued and
 * collected, what happened to the lessons, students, and teacher pay
 * (admins), with the six months up to it.
 */
@Component({
  selector: 'app-admin-reports',
  imports: [PageLog, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <h1>Reports</h1>
          <p>
            {{ name() }} · Cairo days{{ report.value()?.inProgress ? ' · month in progress' : '' }}
          </p>
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
          <span class="m" aria-live="polite">{{ name() }}</span>
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
      </header>

      @if (report.value(); as r) {
        <section aria-labelledby="rep-money" class="group">
          <h2 id="rep-money">Money</h2>
          <div class="stats">
            <div class="stat">
              <span>Invoiced this month</span><span>{{ total(r.money.issued) }}</span
              ><small class="muted">{{ count(r.money.issued, 'invoice') }}</small>
            </div>
            <div class="stat">
              <span>Collected this month</span
              ><span [class.ok]="r.money.collected.length">{{ total(r.money.collected) }}</span
              ><small class="muted">{{ count(r.money.collected, 'payment') }}</small>
            </div>
            <div class="stat">
              <span>Due now</span
              ><span [class.bad]="r.money.dueNow.length">{{ total(r.money.dueNow) }}</span
              ><small class="muted"
                ><a routerLink="/admin/invoices">{{
                  count(r.money.dueNow, 'unpaid invoice')
                }}</a></small
              >
            </div>
            <div class="stat">
              <span>Voided this month</span><span>{{ r.money.voided }}</span
              ><small class="muted">invoices</small>
            </div>
          </div>
        </section>

        <section aria-labelledby="rep-lessons" class="group">
          <h2 id="rep-lessons">Lessons</h2>
          <div class="stats">
            <div class="stat">
              <span>Held</span><span>{{ r.lessons.held }}</span
              ><small class="muted">both entered class</small>
            </div>
            <div class="stat">
              <span>Student absent</span><span>{{ r.lessons.studentAbsent }}</span
              ><small class="muted">counted, teacher paid</small>
            </div>
            <div class="stat">
              <span>Nobody came</span><span>{{ r.lessons.nobodyCame }}</span
              ><small class="muted">counted, teacher not paid</small>
            </div>
            <div class="stat">
              <span>Cancelled</span><span>{{ cancelled(r) }}</span
              ><small class="muted">{{ cancelText(r) }}</small>
            </div>
            <div class="stat">
              <span>Moved</span><span>{{ r.lessons.moved }}</span
              ><small class="muted">to another time</small>
            </div>
            <div class="stat">
              <span>Extra and makeup</span><span>{{ r.lessons.extra + r.lessons.makeup }}</span
              ><small class="muted"
                >{{ r.lessons.extra }} extra (billed) · {{ r.lessons.makeup }} makeup</small
              >
            </div>
            @if (r.lessons.toCheck) {
              <div class="stat">
                <span>To check</span><span class="warn">{{ r.lessons.toCheck }}</span
                ><small class="muted"
                  ><a routerLink="/admin/today" fragment="attendance"
                    >someone did not enter</a
                  ></small
                >
              </div>
            }
            @if (r.inProgress) {
              <div class="stat">
                <span>Still to come</span><span>{{ r.lessons.upcoming }}</span
                ><small class="muted">booked for later this month</small>
              </div>
            }
          </div>
        </section>

        <div class="two">
          <section aria-labelledby="rep-students" class="group">
            <h2 id="rep-students">Students</h2>
            <div class="stats">
              <div class="stat">
                <span>Active now</span><span>{{ r.students.active }}</span>
              </div>
              <div class="stat">
                <span>Started this month</span><span>{{ r.students.started }}</span
                ><small class="muted">first lessons in {{ short(r.month) }}</small>
              </div>
            </div>
          </section>
          @if (r.teacherPay; as p) {
            <section aria-labelledby="rep-pay" class="group">
              <h2 id="rep-pay">Teacher pay</h2>
              <div class="stats">
                <div class="stat">
                  <span>Earned this month</span><span>{{ total(p.owed) }}</span
                  ><small class="muted"
                    >{{ p.teachers === 1 ? '1 teacher' : p.teachers + ' teachers' }} · hours ×
                    rate</small
                  >
                </div>
                <div class="stat">
                  <span>Recorded as paid</span
                  ><span [class.ok]="p.teachers > 0 && p.teachersPaid >= p.teachers">{{
                    total(p.recorded)
                  }}</span
                  ><small class="muted"
                    ><a routerLink="/admin/teachers"
                      >{{ p.teachersPaid }} of {{ p.teachers }} paid</a
                    ></small
                  >
                </div>
              </div>
            </section>
          }
        </div>

        <section class="card flush" aria-labelledby="rep-trend">
          <div class="card-head">
            <h2 id="rep-trend">Last 6 months</h2>
            <span class="muted small"
              >collected{{ trendCurrency() ? ' (' + trendCurrency() + ')' : '' }} and lessons
              held</span
            >
          </div>
          <div class="table-wrap">
            <table class="data trend" aria-labelledby="rep-trend">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Collected</th>
                  <th>Lessons held</th>
                </tr>
              </thead>
              <tbody>
                @for (t of trend(); track t.month) {
                  <tr [class.now]="t.month === r.month">
                    <td>{{ short(t.month) }}</td>
                    <td>
                      <div class="barcell">
                        <span class="bar money" [style.width.%]="t.moneyPct"></span
                        ><span class="num">{{ t.moneyText }}</span>
                      </div>
                    </td>
                    <td>
                      <div class="barcell">
                        <span class="bar held" [style.width.%]="t.heldPct"></span
                        ><span class="num">{{ t.held }}</span>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      } @else {
        <p class="empty">{{ report.error() ? 'Could not load the report.' : 'Loading…' }}</p>
      }
      @if (message()) {
        <p class="notice danger" role="alert">{{ message() }}</p>
      }
      <app-page-log title="Downloads" actions="export." />
    </div>
  `,
  styles: `
    .nav {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    .m {
      min-width: 130px;
      text-align: center;
      font-weight: 600;
    }
    .group {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .group h2 {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
    }
    .stat small {
      font-size: 13px;
    }
    .stat span.ok {
      color: var(--primary);
    }
    .stat span.bad {
      color: var(--danger);
    }
    .stat span.warn {
      color: var(--warn);
    }
    .stat .n,
    .stat span:nth-child(2) {
      font-size: 26px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .two {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 24px;
    }
    .small {
      font-size: 13px;
    }
    .trend {
      min-width: 520px;
    }
    .trend tr.now td {
      font-weight: 700;
    }
    .barcell {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 160px;
    }
    .bar {
      display: block;
      height: 10px;
      border-radius: 5px;
      min-width: 2px;
    }
    .bar.money {
      background: var(--primary);
    }
    .bar.held {
      background: var(--accent);
    }
    .num {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
  `,
})
export class AdminReports {
  private readonly api = inject(ApiService);
  protected readonly busy = signal(false);
  protected readonly message = signal('');

  protected readonly thisMonth = localDate(new Date(), ACADEMY_TZ).slice(0, 7);
  protected readonly month = linkedSignal(() => this.thisMonth);
  protected readonly shift = shiftMonth;
  protected readonly name = computed(() => monthName(this.month()));
  protected readonly report = httpResource<MonthlyReport>(() => ({
    url: '/api/stats/monthly',
    params: { month: this.month() },
  }));

  /** The trend charts the currency with the most money in the six months. */
  protected readonly trendCurrency = computed(() => {
    const sums = new Map<string, number>();
    for (const t of this.report.value()?.trend ?? [])
      for (const c of t.collected) sums.set(c.currency, (sums.get(c.currency) ?? 0) + c.cents);
    return [...sums].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  });
  protected readonly trend = computed(() => {
    const rows = this.report.value()?.trend ?? [];
    const cur = this.trendCurrency();
    const cents = rows.map((t) => t.collected.find((c) => c.currency === cur)?.cents ?? 0);
    const maxMoney = Math.max(1, ...cents);
    const maxHeld = Math.max(1, ...rows.map((t) => t.held));
    return rows.map((t, i) => ({
      month: t.month,
      held: t.held,
      heldPct: (t.held / maxHeld) * 100,
      moneyPct: (cents[i] / maxMoney) * 100,
      moneyText: cur ? money(cents[i], cur) : '—',
    }));
  });

  protected short(m: string) {
    return monthName(m, 'short') + ' ' + m.slice(0, 4);
  }
  protected total(lines: MoneyLine[]) {
    return lines.length ? lines.map((l) => money(l.cents, l.currency)).join(' + ') : '0';
  }
  protected count(lines: MoneyLine[], noun: string) {
    const n = lines.reduce((t, l) => t + l.count, 0);
    return `${n} ${noun}${n === 1 ? '' : 's'}`;
  }
  protected cancelled(r: MonthlyReport) {
    const l = r.lessons;
    return l.byStudent + l.byTeacher + l.byAcademy + l.unpaid;
  }
  protected cancelText(r: MonthlyReport) {
    const l = r.lessons;
    const parts = [
      l.byStudent && `${l.byStudent} by students`,
      l.byTeacher && `${l.byTeacher} by teachers`,
      l.byAcademy && `${l.byAcademy} by the academy`,
      l.unpaid && `${l.unpaid} unpaid`,
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : 'none';
  }
}
