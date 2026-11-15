import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import {
  ACADEMY_TZ,
  city,
  day,
  localDate,
  money,
  shiftMonth,
  time,
  typeLabel,
} from '../../core/format';
import type { Lesson } from '../../core/models';
import { LessonStatus } from '../../shared/lesson-status';

const PAGE = 30;

/**
 * A held lesson should get notes; these are the ones the teacher still owes.
 * Not when the student was absent or nobody came. A lesson nobody entered
 * counts as held once the academy says so.
 */
export function needsNotes(l: Pick<Lesson, 'status' | 'notes' | 'attendance'>): boolean {
  const held =
    l.status === 'COMPLETED' && l.attendance !== 'TEACHER_ONLY' && l.attendance !== 'NONE';
  return held && !l.notes?.trim();
}

/** The teacher's past lessons, newest first, and which still need notes. */
@Component({
  selector: 'app-teacher-history',
  imports: [RouterLink, LessonStatus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <h1>Past lessons</h1>
          <p>Newest first · Cairo time</p>
        </div>
        <label class="check">
          <input
            type="checkbox"
            [checked]="onlyMissing()"
            (change)="onlyMissing.set($any($event.target).checked)"
          />
          Only lessons without notes ({{ missingCount() }})
        </label>
      </header>

      @if (error()) {
        <p class="notice danger" role="alert">{{ error() }}</p>
      }

      @if (myMonth.value(); as m) {
        <section class="card month" aria-labelledby="my-month">
          <div class="mhead">
            <h2 id="my-month">Your month</h2>
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
          <div class="nums">
            <div>
              <span class="big">{{ m.counted }}</span
              ><span class="muted small">lessons that count for you</span>
            </div>
            <div>
              <span class="big">{{ hours(m.minutes) }}</span
              ><span class="muted small">hours</span>
            </div>
            <div>
              <span class="big">{{ m.studentAbsent }}</span
              ><span class="muted small">of them the student was absent</span>
            </div>
            <div>
              <span class="big">{{ m.notCounted }}</span
              ><span class="muted small">don't count (you or nobody came)</span>
            </div>
            @if (m.toCheck) {
              <div>
                <span class="big warn">{{ m.toCheck }}</span
                ><span class="muted small">the academy is still checking</span>
              </div>
            }
          </div>
          <div class="pay" data-testid="my-pay">
            @if (m.paid; as p) {
              <span class="chip ok">Paid</span>
              <strong>{{ money(p.amountCents, p.currency) }}</strong>
              <span class="muted small">recorded by the academy for this month</span>
            } @else if (m.expectedPayCents !== null && m.rateCents !== null) {
              <strong>{{ money(m.expectedPayCents, m.currency) }}</strong>
              <span class="muted small"
                >{{ month() >= thisMonth ? 'so far' : 'expected' }} · {{ hours(m.minutes) }} hours ×
                {{ money(m.rateCents, m.currency) }} an hour{{
                  m.toCheck ? ' · lessons still being checked are not counted yet' : ''
                }}</span
              >
            } @else {
              <span class="muted small">Your pay per hour is not set yet. Ask the academy.</span>
            }
          </div>
        </section>
      }

      <section class="card flush">
        <div class="table-wrap">
          <table class="data" style="min-width: 720px">
            <thead>
              <tr>
                <th>When (Cairo)</th>
                <th>Student</th>
                <th>Status</th>
                <th>Notes &amp; homework</th>
              </tr>
            </thead>
            <tbody>
              @for (l of shown(); track l.id) {
                <tr>
                  <td>
                    <strong>{{ d(l.startsAt) }} · {{ t(l.startsAt) }}</strong>
                    <span class="sub">{{ local(l) }}</span>
                  </td>
                  <td>
                    {{ l.student.name }}
                    <span class="sub">{{ l.curriculum }} · {{ type(l) }}</span>
                  </td>
                  <td><app-lesson-status [lesson]="l" /></td>
                  <td>
                    @if (l.status === 'CANCELLED' || l.status === 'RESCHEDULED') {
                      <span class="muted">—</span>
                    } @else if (needs(l)) {
                      <a class="btn small" [routerLink]="['/teacher/lessons', l.id]">Add notes</a>
                    } @else if (l.notes?.trim() || l.homeworkTitle) {
                      <a [routerLink]="['/teacher/lessons', l.id]">{{
                        l.homeworkTitle ? 'Homework: ' + l.homeworkTitle : 'Notes added'
                      }}</a>
                    } @else {
                      <a [routerLink]="['/teacher/lessons', l.id]">Details</a>
                    }
                  </td>
                </tr>
              } @empty {
                @if (!loading()) {
                  <tr>
                    <td colspan="4" class="empty">
                      {{
                        onlyMissing()
                          ? 'All caught up: every lesson has notes.'
                          : 'No past lessons yet.'
                      }}
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      </section>

      @if (loading()) {
        <p class="muted" role="status">Loading…</p>
      } @else if (hasMore()) {
        <div>
          <button type="button" class="btn" (click)="loadMore()">Show earlier lessons</button>
        </div>
      }
    </div>
  `,
  styles: `
    .pay {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 8px;
      padding-top: 12px;
      border-top: 1px solid var(--border);
    }
    .pay strong {
      font-size: 18px;
    }
    .check {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 40px;
      font-weight: 500;
    }
    .check input {
      width: 18px;
      height: 18px;
    }
    .sub {
      display: block;
      font-size: 13px;
      color: var(--muted);
    }
    .month {
      gap: 12px;
    }
    .mhead {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }
    .nav {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .m {
      min-width: 120px;
      text-align: center;
      font-weight: 600;
    }
    .nums {
      display: flex;
      flex-wrap: wrap;
      gap: 12px 32px;
    }
    .nums > div {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 110px;
    }
    .big {
      font-size: 26px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .big.warn {
      color: var(--warn);
    }
    .small {
      font-size: 13px;
    }
  `,
})
export class TeacherHistory {
  private readonly api = inject(ApiService);
  protected readonly thisMonth = localDate(new Date(), ACADEMY_TZ).slice(0, 7);
  protected readonly month = signal(this.thisMonth);
  protected readonly shift = shiftMonth;
  protected readonly monthName = computed(() =>
    new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${this.month()}-15T12:00:00Z`),
    ),
  );
  /** The teacher's own lessons, hours and what they come to at their rate. */
  protected readonly myMonth = httpResource<{
    rateCents: number | null;
    currency: string;
    expectedPayCents: number | null;
    paid: { amountCents: number; currency: string; paidAt: string } | null;
    counted: number;
    minutes: number;
    studentAbsent: number;
    notCounted: number;
    toCheck: number;
  }>(() => ({
    url: '/api/stats/my-month',
    params: { month: this.month() },
  }));
  protected readonly money = money;
  protected hours(min: number) {
    return (min / 60).toLocaleString('en-US', { maximumFractionDigits: 1 });
  }
  private readonly lessons = signal<Lesson[]>([]);
  protected readonly loading = signal(true);
  protected readonly hasMore = signal(false);
  protected readonly error = signal('');
  protected readonly onlyMissing = signal(false);
  protected readonly needs = needsNotes;

  protected readonly missingCount = computed(() => this.lessons().filter(needsNotes).length);
  protected readonly shown = computed(() =>
    this.onlyMissing() ? this.lessons().filter(needsNotes) : this.lessons(),
  );

  constructor() {
    void this.load(new Date().toISOString());
  }

  protected loadMore() {
    const oldest = this.lessons().at(-1);
    if (oldest) void this.load(oldest.startsAt);
  }

  private async load(to: string) {
    this.loading.set(true);
    this.error.set('');
    try {
      const page = await this.api.lessonHistory(to, PAGE);
      // Lessons still running are not "past" yet.
      const now = Date.now();
      const done = page.filter(
        (l) => new Date(l.startsAt).getTime() + l.durationMin * 60_000 <= now,
      );
      this.lessons.update((all) => [...all, ...done]);
      this.hasMore.set(page.length === PAGE);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected d(iso: string) {
    return day(iso, ACADEMY_TZ);
  }
  protected t(iso: string) {
    return time(iso, ACADEMY_TZ);
  }
  protected local(l: Lesson) {
    return `${time(l.startsAt, l.student.timezone)} in ${city(l.student.timezone)}`;
  }
  protected type(l: Lesson) {
    return typeLabel(l.type, l.extraReason);
  }
}
