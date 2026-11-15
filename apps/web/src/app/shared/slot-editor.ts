import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { ACADEMY_TZ, nextWeekday, time, WEEKDAYS, zonedTimeToUtc } from '../core/format';
import type { Slot } from '../core/models';

/**
 * Weekly lesson times on the student's clock. Shows the matching Cairo time
 * for the first week so staff can check it against the teacher's hours.
 */
@Component({
  selector: 'app-slot-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="slots">
      @for (s of slots(); track $index; let i = $index) {
        <div class="slot">
          <label class="sr-only" [attr.for]="'slot-day-' + i">Day {{ i + 1 }}</label>
          <select
            [id]="'slot-day-' + i"
            [value]="s.weekday"
            (change)="setDay(i, $any($event.target).value)"
          >
            @for (d of days; track d.value) {
              <option [value]="d.value" [selected]="d.value === s.weekday">{{ d.label }}</option>
            }
          </select>
          <label class="sr-only" [attr.for]="'slot-time-' + i">Time {{ i + 1 }}</label>
          <input
            [id]="'slot-time-' + i"
            type="time"
            step="900"
            [value]="s.startTime"
            (change)="setTime(i, $any($event.target).value)"
          />
          <span class="muted cairo">{{ cairo()[i] }}</span>
          @if (slots().length > 1) {
            <button
              type="button"
              class="remove"
              [attr.aria-label]="'Remove ' + dayName(s.weekday) + ' ' + s.startTime"
              (click)="remove(i)"
            >
              ×
            </button>
          }
        </div>
      }
      @if (slots().length < 7) {
        <div><button type="button" class="btn small" (click)="add()">+ Add a day</button></div>
      }
    </div>
  `,
  styles: `
    .slots {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .slot {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    select,
    input {
      min-height: 44px;
      padding: 0 10px;
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      font: inherit;
      background: #fff;
    }
    .cairo {
      font-size: 13px;
    }
    .remove {
      min-width: 36px;
      min-height: 36px;
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      background: #fff;
      font-size: 18px;
      line-height: 1;
      color: var(--muted);
      cursor: pointer;
    }
    .remove:hover {
      color: var(--danger, #b42318);
    }
  `,
})
export class SlotEditor {
  readonly slots = model.required<Slot[]>();
  readonly timezone = input.required<string>();
  readonly startDate = input.required<string>();

  protected readonly days = [6, 7, 1, 2, 3, 4, 5].map((value) => ({
    value,
    label: WEEKDAYS[value - 1],
  }));

  protected readonly cairo = computed(() =>
    this.slots().map((s) => {
      if (!this.startDate() || !/^\d{2}:\d{2}$/.test(s.startTime)) return '';
      const date = nextWeekday(this.startDate(), s.weekday);
      const at = zonedTimeToUtc(date, s.startTime, this.timezone());
      return `= ${new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: ACADEMY_TZ }).format(at)} ${time(at, ACADEMY_TZ)} Cairo`;
    }),
  );

  protected setDay(i: number, value: string) {
    this.slots.update((list) =>
      list.map((s, j) => (j === i ? { ...s, weekday: Number(value) } : s)),
    );
  }

  protected dayName(weekday: number) {
    return WEEKDAYS[weekday - 1];
  }

  protected add() {
    this.slots.update((list) => resizeSlots(list, list.length + 1));
  }

  protected remove(i: number) {
    this.slots.update((list) => list.filter((_, j) => j !== i));
  }

  protected setTime(i: number, value: string) {
    this.slots.update((list) => list.map((s, j) => (j === i ? { ...s, startTime: value } : s)));
  }
}

/** Grow or shrink a slot list to `count`, keeping the ones already set. */
export function resizeSlots(slots: Slot[], count: number): Slot[] {
  const next = slots.slice(0, count);
  const used = new Set(next.map((s) => s.weekday));
  for (const day of [2, 4, 6, 1, 3, 7, 5]) {
    if (next.length >= count) break;
    if (!used.has(day)) {
      next.push({ weekday: day, startTime: next[0]?.startTime ?? '17:00' });
      used.add(day);
    }
  }
  return next;
}
