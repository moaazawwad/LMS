import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { dayTime, money, time } from '../../core/format';
import type { DueInvoice, StudentOverview } from '../../core/models';
import { Icon } from '../../shared/icon';
import { MyRequests } from '../../shared/my-requests';
import { ToastService } from '../../core/toast.service';

const NOTICE_MS = 4 * 3_600_000;

@Component({
  selector: 'app-student-home',
  imports: [RouterLink, Icon, MyRequests],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <h1>Hi {{ firstName() }}</h1>
          <p>{{ nowLabel }} · {{ tz }} time</p>
        </div>
      </header>

      @for (inv of due.value(); track inv.id) {
        @if (inv.onHold || inv.overdue) {
          <p
            class="notice due"
            [class.danger]="inv.onHold"
            [class.warn]="!inv.onHold"
            data-testid="due-notice"
          >
            <span>
              @if (inv.onHold) {
                <strong>Your lessons are on hold.</strong> Invoice {{ inv.number }} for
                {{ money(inv.totalCents, inv.currency) }} is not paid, so your remaining lessons
                were removed. They come back as soon as it is paid.
              } @else {
                <strong
                  >Invoice {{ inv.number }} for {{ money(inv.totalCents, inv.currency) }} is not
                  paid yet.</strong
                >
                @if (inv.lessonsLeftBeforeHold > 0) {
                  You can take {{ inv.lessonsLeftBeforeHold }} more
                  {{ inv.lessonsLeftBeforeHold === 1 ? 'lesson' : 'lessons' }} before paying; after
                  that your lessons stop until it is paid.
                } @else {
                  Your remaining lessons stop until it is paid.
                }
              }
            </span>
            <a class="btn small" [routerLink]="['/student/invoices', inv.id]">See how to pay</a>
          </p>
        }
      }

      @if (overview.value(); as o) {
        <div class="cols">
          <div class="main">
            @if (o.upcoming[0]; as n) {
              <section class="hero" aria-labelledby="next-title">
                <div class="row">
                  <div>
                    <span id="next-title" class="eyebrow">{{
                      n.canEnter ? 'Your lesson is starting' : 'Next lesson'
                    }}</span>
                    <span class="big num">{{ t(n.startsAt) }}</span>
                    <span
                      >{{ d(n.startsAt) }} · with {{ n.teacher }} · {{ n.durationMin }} min</span
                    >
                  </div>
                  <button
                    type="button"
                    class="enter"
                    [disabled]="!n.canEnter"
                    (click)="enter(n.id)"
                  >
                    <app-icon name="video" [size]="22" [stroke]="2" /> Enter class
                  </button>
                </div>
                <div class="hint">
                  <span>
                    {{
                      n.canEnter
                        ? 'Pressing Enter class marks you present.'
                        : 'Enter class opens 10 minutes before the lesson.'
                    }}
                    @if (soon(n.startsAt)) {
                      Less than 4 hours to go, so this lesson can't be changed online.
                    }
                  </span>
                  <span class="hero-actions">
                    @if (!soon(n.startsAt)) {
                      <a
                        class="btn small on-dark"
                        [routerLink]="['/student/reschedule', n.id]"
                        [class.disabled]="!canReschedule(o, n.startsAt)"
                        >Reschedule</a
                      >
                      <button
                        type="button"
                        class="btn small on-dark"
                        [disabled]="!canCancel(o, n.startsAt)"
                        (click)="cancel(n.id, n.startsAt)"
                      >
                        Cancel
                      </button>
                    }
                    @if (needsAsking(o, n.startsAt)) {
                      <a class="btn small on-dark" [routerLink]="['/student/ask', n.id]"
                        >Ask the academy</a
                      >
                    }
                  </span>
                </div>
              </section>
            }

            <section class="card flush">
              <div class="card-head">
                <h2>Next lessons</h2>
                <a routerLink="/student/calendar">Calendar</a>
              </div>
              @for (l of o.upcoming.slice(1); track l.id) {
                <div class="list-row">
                  <div class="grow">
                    <strong>{{ d(l.startsAt) }} · {{ t(l.startsAt) }}</strong>
                    <span class="sub">{{ l.teacher }}</span>
                  </div>
                  <a
                    class="btn small"
                    [routerLink]="['/student/reschedule', l.id]"
                    [class.disabled]="!canReschedule(o, l.startsAt)"
                    >Reschedule</a
                  >
                  <button
                    type="button"
                    class="btn small"
                    [disabled]="!canCancel(o, l.startsAt)"
                    (click)="cancel(l.id, l.startsAt)"
                  >
                    Cancel
                  </button>
                  @if (needsAsking(o, l.startsAt)) {
                    <a class="btn small" [routerLink]="['/student/ask', l.id]">Ask the academy</a>
                  }
                </div>
              } @empty {
                <p class="empty">No other lessons coming up.</p>
              }
              @if (cancelsLeft(o) === 0) {
                <p class="notice warn flat">
                  You've used all cancellations this cycle. Use "Ask the academy" on a lesson; a
                  cancel then usually counts as taken.
                </p>
              }
            </section>
          </div>

          <div class="side">
            <app-my-requests [timezone]="zone()" />
            @if (o.lastLesson; as last) {
              <section class="card">
                <h2>Homework</h2>
                <strong>{{ last.homeworkTitle || 'No homework set' }}</strong>
                @if (last.homeworkBody) {
                  <p class="muted pre">{{ last.homeworkBody }}</p>
                }
                <span class="muted small">From the lesson on {{ d(last.startsAt) }}</span>
                @if (last.homeworkTitle || last.homeworkBody) {
                  <a
                    class="btn small hw"
                    [routerLink]="['/student/lessons', last.id]"
                    >{{ last.homeworkCheckedAt ? 'Read your teacher's reply' : last.homeworkSentAt ? 'Sent · change your answer' : 'Send your answer' }}</a
                  >
                }
                <a routerLink="/student/lessons">All lessons &amp; homework</a>
              </section>
            }
            @if (o.subscription; as sub) {
              <section class="card">
                <h2>Your plan · {{ sub.plan.name }}</h2>
                <div class="kv">
                  <span>Cancellations left</span
                  ><strong>{{ left(sub.plan.cancelQuota, o.cycle?.cancelsUsed) }}</strong>
                </div>
                <div class="kv">
                  <span>Reschedules left</span
                  ><strong>{{ left(sub.plan.rescheduleQuota, o.cycle?.reschedulesUsed) }}</strong>
                </div>
                <div class="kv">
                  <span>Lesson credits</span
                  ><strong style="color: var(--primary)"
                    >{{ o.pendingCredits }} off next invoice</strong
                  >
                </div>
                @if (o.cycle; as c) {
                  <span class="muted small"
                    >This cycle ends {{ c.endDate }}. Changes need at least 4 hours' notice.</span
                  >
                }
              </section>
            }
          </div>
        </div>
      } @else {
        <p class="empty">{{ overview.error() ? 'Could not load your lessons.' : 'Loading…' }}</p>
      }
    </div>
  `,
  styles: `
    .hw {
      align-self: flex-start;
    }
    .hero {
      background: var(--primary);
      color: #fff;
      border-radius: 16px;
      padding: 26px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: flex-end;
      gap: 20px;
    }
    .row > div {
      display: flex;
      flex-direction: column;
      gap: 6px;
      color: #e3efe8;
    }
    .eyebrow {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #cfe3d8;
    }
    .big {
      font-size: 44px;
      font-weight: 700;
      color: #fff;
      letter-spacing: -0.02em;
    }
    .enter {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      min-height: 56px;
      padding: 0 26px;
      border: 0;
      border-radius: 12px;
      background: #fff;
      color: var(--primary);
      font: inherit;
      font-size: 17px;
      font-weight: 700;
      cursor: pointer;
    }
    .enter:disabled {
      background: rgba(255, 255, 255, 0.35);
      color: #e3efe8;
      cursor: not-allowed;
    }
    .hint {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px 16px;
      padding-top: 14px;
      border-top: 1px solid rgba(255, 255, 255, 0.2);
      color: #e3efe8;
      font-size: 14px;
    }
    .hero-actions {
      display: flex;
      gap: 8px;
    }
    .on-dark {
      background: transparent;
      color: #fff;
      border-color: rgba(255, 255, 255, 0.55);
    }
    .on-dark:disabled,
    .on-dark.disabled {
      opacity: 0.5;
    }
    .grow {
      flex: 1 1 220px;
    }
    .flat {
      margin: 0;
      border-radius: 0;
    }
    .kv {
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }
    .small {
      font-size: 13px;
    }
    .pre {
      white-space: pre-line;
      margin: 0;
    }
    a.disabled {
      pointer-events: none;
      opacity: 0.5;
    }
  `,
})
export class StudentHome {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  protected readonly tz = this.auth.user()?.timezone ?? 'UTC';
  /** Invoices that need paying, with how many lessons are left before a hold. */
  protected readonly due = httpResource<DueInvoice[]>(() => '/api/invoices/due', {
    defaultValue: [],
  });
  protected readonly money = money;
  protected readonly overview = httpResource<StudentOverview>(
    () => `/api/students/${this.auth.user()?.studentId}/overview`,
  );
  private readonly toast = inject(ToastService);
  protected readonly nowLabel = dayTime(new Date(), this.tz);
  protected readonly firstName = computed(() => this.auth.user()?.fullName.split(' ')[0] ?? '');

  protected zone() {
    return this.overview.value()?.subscription?.timezone ?? this.tz;
  }
  protected t(iso: string) {
    return time(iso, this.zone());
  }
  protected d(iso: string) {
    return dayTime(iso, this.zone()).split(' · ')[0];
  }
  protected soon(iso: string) {
    return new Date(iso).getTime() - Date.now() < NOTICE_MS;
  }
  protected left(quota: number | null, used: number | undefined) {
    return quota === null ? 'Unlimited' : `${Math.max(0, quota - (used ?? 0))} of ${quota}`;
  }
  protected cancelsLeft(o: StudentOverview) {
    const q = o.subscription?.plan.cancelQuota;
    return q === null || q === undefined ? null : Math.max(0, q - (o.cycle?.cancelsUsed ?? 0));
  }
  protected canCancel(o: StudentOverview, iso: string) {
    return !this.soon(iso) && this.cancelsLeft(o) !== 0;
  }
  /** Something can't be done online, so offer to ask instead. */
  protected needsAsking(o: StudentOverview, iso: string) {
    return !this.canCancel(o, iso) || !this.canReschedule(o, iso);
  }
  protected canReschedule(o: StudentOverview, iso: string) {
    const q = o.subscription?.plan.rescheduleQuota;
    const left = q === null || q === undefined ? 1 : q - (o.cycle?.reschedulesUsed ?? 0);
    return !this.soon(iso) && left > 0;
  }

  protected async enter(id: string) {
    try {
      const { zoomLink } = await this.api.enterClass(id);
      if (zoomLink) window.open(zoomLink, '_blank', 'noopener');
    } catch {
      // the message at the top says why
    }
  }

  protected async cancel(id: string, iso: string) {
    if (
      !confirm(
        `Cancel your lesson on ${this.d(iso)} at ${this.t(iso)}? It comes off your next invoice.`,
      )
    )
      return;
    try {
      await this.api.cancelLesson(id);
      this.toast.success('Lesson cancelled. It will come off your next invoice.');
      this.overview.reload();
    } catch {
      // the message at the top says why
    }
  }
}
