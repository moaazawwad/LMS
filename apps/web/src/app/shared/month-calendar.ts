import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, input, linkedSignal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { addDays, dayTime, localDate, monthGrid, shiftMonth, time } from '../core/format';
import type { Lesson } from '../core/models';

/**
 * A month of lessons on one clock (the student's, or Cairo for teachers).
 * Every lesson is a link to its page. The API already limits the list to the
 * signed-in person's own lessons.
 */
@Component({
  selector: 'app-month-calendar',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <h1>{{ title() }}</h1>
          <p>{{ subtitle() }}</p>
        </div>
        <div class="nav">
          <button
            type="button"
            class="btn"
            aria-label="Previous month"
            (click)="month.set(shift(month(), -1))"
          >
            ‹
          </button>
          <button type="button" class="btn" (click)="month.set(thisMonth())">Today</button>
          <button
            type="button"
            class="btn"
            aria-label="Next month"
            (click)="month.set(shift(month(), 1))"
          >
            ›
          </button>
        </div>
      </header>
      <section class="card flush">
        <div class="table-wrap">
          <div class="month">
            @for (w of weekdays; track w) {
              <span class="wd" aria-hidden="true">{{ w }}</span>
            }
            @for (c of cells(); track c.date) {
              <div class="cell" [class.out]="!c.inMonth" [class.today]="c.date === today()">
                <span class="dnum">{{ c.day }}</span>
                @for (l of c.lessons; track l.id) {
                  <a
                    class="ev"
                    [class]="'ev ' + kind(l)"
                    [routerLink]="link(l)"
                    [attr.aria-label]="label(l)"
                  >
                    {{ t(l.startsAt) }}
                    @if (showStudent()) {
                      &ngsp;<span class="who">{{ l.student.name.split(' ')[0] }}</span>
                    }
                  </a>
                }
              </div>
            }
          </div>
        </div>
        <div class="legend">
          <span><i class="ev done"></i>Done</span>
          <span><i class="ev next"></i>Coming up</span>
          <span><i class="ev missed"></i>Someone did not come</span>
          <span><i class="ev cancel"></i>Cancelled</span>
          <span><i class="ev moved"></i>Moved to another time</span>
        </div>
      </section>
      @if (lessons.error()) {
        <p class="notice danger" role="alert">Could not load the lessons. Try again in a moment.</p>
      }
    </div>
  `,
  styles: `
    .nav {
      display: flex;
      gap: 8px;
    }
    .month {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 1px;
      background: var(--border);
      min-width: 640px;
    }
    .wd {
      background: var(--surface-muted);
      padding: 10px 12px;
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
    }
    .cell {
      background: #fff;
      min-height: 96px;
      padding: 8px;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
    }
    .cell.out {
      background: var(--surface-muted);
      color: var(--muted);
    }
    .cell.today {
      background: #f3f8f5;
    }
    .cell.today .dnum {
      background: var(--primary);
      color: #fff;
      border-radius: 50%;
      width: 26px;
      height: 26px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .dnum {
      font-size: 13px;
      font-weight: 600;
    }
    .ev {
      display: inline-flex;
      gap: 4px;
      padding: 3px 6px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      text-decoration: none;
    }
    a.ev:hover {
      outline: 2px solid currentColor;
      outline-offset: 1px;
    }
    .who {
      font-weight: 500;
    }
    .ev.done {
      background: var(--neutral-tint);
      color: var(--ink-2);
    }
    .ev.next {
      background: var(--info-tint);
      color: var(--info);
    }
    .ev.missed {
      background: var(--warn-tint);
      color: var(--warn);
    }
    .ev.cancel {
      background: var(--danger-tint);
      color: var(--danger);
      text-decoration: line-through;
    }
    .ev.moved {
      border: 1px dashed #c26a0c;
      color: var(--warn);
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 20px;
      padding: 12px 18px;
      border-top: 1px solid var(--border);
      font-size: 12px;
    }
    .legend span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .legend i {
      width: 12px;
      height: 12px;
      padding: 0;
    }
  `,
})
export class MonthCalendar {
  /** IANA zone the month is laid out in. */
  readonly timezone = input.required<string>();
  readonly subtitle = input('');
  /** Route the lesson links go to, e.g. "/student/lessons". */
  readonly linkBase = input('');
  /** Teachers see whose lesson it is. */
  readonly showStudent = input(false);
  /** Staff looking at one person's month. */
  readonly teacherId = input<string | undefined>(undefined);
  readonly studentId = input<string | undefined>(undefined);
  /** Where a lesson link goes; by default `linkBase/<lesson id>`. */
  readonly linkFor = input<((l: Lesson) => unknown[]) | undefined>(undefined);

  protected readonly weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  protected readonly shift = shiftMonth;
  protected readonly today = computed(() => localDate(new Date(), this.timezone()));
  protected readonly thisMonth = computed(() => this.today().slice(0, 7));
  /** Starts on the current month of the calendar's own clock; the arrows move it. */
  protected readonly month = linkedSignal(() => this.thisMonth());
  private readonly days = computed(() => monthGrid(this.month()));

  protected readonly lessons = httpResource<Lesson[]>(
    () => {
      const days = this.days();
      // A day of margin each side: the API filters by instant, the grid by local date.
      const params: Record<string, string> = {
        from: `${addDays(days[0], -1)}T00:00:00Z`,
        to: `${addDays(days[41], 2)}T00:00:00Z`,
      };
      const teacherId = this.teacherId();
      const studentId = this.studentId();
      if (teacherId) params['teacherId'] = teacherId;
      if (studentId) params['studentId'] = studentId;
      return { url: '/api/lessons', params };
    },
    { defaultValue: [] },
  );

  protected readonly cells = computed(() => {
    const tz = this.timezone();
    const byDay = new Map<string, Lesson[]>();
    for (const l of this.lessons.value()) {
      const d = localDate(l.startsAt, tz);
      byDay.set(d, [...(byDay.get(d) ?? []), l]);
    }
    return this.days().map((date) => ({
      date,
      day: Number(date.slice(8)),
      inMonth: date.startsWith(this.month()),
      lessons: byDay.get(date) ?? [],
    }));
  });

  protected readonly title = computed(() =>
    new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${this.month()}-15T12:00:00Z`),
    ),
  );

  protected link(l: Lesson) {
    return this.linkFor()?.(l) ?? [this.linkBase(), l.id];
  }

  protected t(iso: string) {
    return time(iso, this.timezone());
  }

  protected kind(l: Lesson) {
    if (l.status === 'COMPLETED')
      return l.attendance === 'TEACHER_ONLY' || l.attendance === 'NONE' ? 'missed' : 'done';
    if (l.status === 'CANCELLED') return 'cancel';
    if (l.status === 'RESCHEDULED') return 'moved';
    return l.missed ? 'missed' : 'next';
  }

  private missedText(l: Lesson) {
    if (l.attendance === 'TEACHER_ONLY' || (!l.attendance && l.teacherJoinedAt))
      return 'student absent';
    if (l.attendance === 'STUDENT_ONLY' || (!l.attendance && l.studentJoinedAt))
      return 'teacher did not enter';
    return l.status === 'COMPLETED' ? 'nobody came' : 'nobody entered';
  }

  protected label(l: Lesson) {
    const status = {
      done: 'done',
      cancel: 'cancelled',
      moved: 'moved',
      missed: this.missedText(l),
      next: 'coming up',
    }[this.kind(l)];
    // Starts with the visible text ("9:00 AM Omar") so voice control finds it.
    const who = this.showStudent() ? ` ${l.student.name}` : '';
    return `${dayTime(l.startsAt, this.timezone())}${who}, ${status}`;
  }
}
