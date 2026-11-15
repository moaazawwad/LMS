import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { minutesToClock, WEEKDAYS } from '../core/format';
import type { Slot } from '../core/models';

interface WeeklyFree {
  timezone: string;
  fromDate: string;
  toDate: string;
  days: { weekday: number; times: string[] }[];
}

/** "14:00" → "2:00 PM" */
function label(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return minutesToClock(h * 60 + m);
}

/**
 * The teacher's free weekly times on the student's clock, free every week of
 * the cycle. Clicking a time fills the next weekly slot in turn.
 */
@Component({
  selector: 'app-free-times',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="free" aria-labelledby="ft-title">
      <div class="head">
        <h3 id="ft-title">Free every week with this teacher</h3>
        <span class="muted small"
          >{{ timezone() }} · {{ data.value()?.fromDate }} to {{ data.value()?.toDate }}</span
        >
      </div>
      @if (data.isLoading()) {
        <p class="muted small">Checking the teacher's week…</p>
      } @else if (data.error()) {
        <p class="muted small">
          Could not load the free times. You can still type the times below.
        </p>
      } @else if (rows().length) {
        <p class="muted small">
          Pick a time for lesson {{ target() + 1 }} of {{ slots().length }}.
        </p>
        <div class="days">
          @for (d of rows(); track d.weekday) {
            <div class="day">
              <span class="dname">{{ d.name }}</span>
              <div class="times" role="group" [attr.aria-label]="d.name">
                @for (t of d.times; track t) {
                  <button
                    type="button"
                    class="t"
                    [class.on]="isChosen(d.weekday, t)"
                    [attr.aria-pressed]="isChosen(d.weekday, t)"
                    (click)="pick(d.weekday, t)"
                  >
                    {{ label(t) }}
                  </button>
                }
              </div>
            </div>
          }
        </div>
      } @else {
        <p class="notice warn">
          <span
            >This teacher has no free weekly time in this cycle. Check their weekly hours or choose
            another teacher.</span
          >
        </p>
      }
    </section>
  `,
  styles: `
    .free {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px;
      border: 1px solid var(--divider);
      border-radius: 12px;
      background: var(--surface-muted);
    }
    .head {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 4px 12px;
      align-items: baseline;
    }
    h3 {
      margin: 0;
      font-size: 14px;
    }
    .small {
      font-size: 13px;
      margin: 0;
    }
    .days {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .day {
      display: flex;
      gap: 10px;
      align-items: flex-start;
    }
    .dname {
      flex: 0 0 40px;
      font-weight: 600;
      font-size: 13px;
      padding-top: 7px;
    }
    .times {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .t {
      min-height: 34px;
      padding: 0 10px;
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      background: #fff;
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }
    .t:hover {
      border-color: var(--primary);
    }
    .t.on {
      border: 2px solid var(--primary);
      background: var(--primary-tint);
      color: var(--primary);
      font-weight: 600;
      padding: 0 9px;
    }
    .notice {
      margin: 0;
    }
  `,
})
export class FreeTimes {
  readonly teacherId = input.required<string>();
  readonly timezone = input.required<string>();
  /** first day of the cycle, YYYY-MM-DD on the student's clock */
  readonly startDate = input.required<string>();
  readonly durationMin = input(60);
  /** when changing an existing subscription's times */
  readonly excludeSubscriptionId = input<string | undefined>(undefined);
  readonly slots = model.required<Slot[]>();

  /** which weekly slot the next click fills */
  protected readonly target = signal(0);
  protected readonly label = label;

  protected readonly data = httpResource<WeeklyFree>(() => {
    if (!this.teacherId() || !this.startDate()) return undefined;
    const params: Record<string, string | number> = {
      timezone: this.timezone(),
      startDate: this.startDate(),
      durationMin: this.durationMin(),
    };
    const exclude = this.excludeSubscriptionId();
    if (exclude) params['excludeSubscriptionId'] = exclude;
    return { url: `/api/teachers/${this.teacherId()}/weekly-free`, params };
  });

  /** Saturday first, like the academy's week; empty days hidden. */
  protected readonly rows = computed(() =>
    [6, 7, 1, 2, 3, 4, 5]
      .map((weekday) => ({
        weekday,
        name: WEEKDAYS[weekday - 1],
        times: this.data.value()?.days.find((d) => d.weekday === weekday)?.times ?? [],
      }))
      .filter((d) => d.times.length),
  );

  protected isChosen(weekday: number, t: string) {
    return this.slots().some((s) => s.weekday === weekday && s.startTime === t);
  }

  protected pick(weekday: number, startTime: string) {
    const n = this.slots().length;
    if (!n) return;
    const i = this.target() % n;
    this.slots.update((list) => list.map((s, j) => (j === i ? { weekday, startTime } : s)));
    this.target.set((i + 1) % n);
  }
}
