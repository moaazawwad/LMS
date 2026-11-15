import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ACADEMY_TZ, city, dayTime, shiftText, time } from '../../core/format';
import type { Lesson, ScheduleCheck } from '../../core/models';

type Problem = ScheduleCheck['problems'][number];

/** Clock changes worth a heads-up on Today. */
const SOON_DAYS = 14;

/**
 * The next six weeks at a glance: lessons outside the teacher's hours or on
 * top of another lesson, and the clock changes coming up. Lessons stay on
 * the student's clock, so a change in Egypt or abroad moves them on Cairo's.
 * Shown only when there is something to act on or a change is close.
 */
@Component({
  selector: 'app-schedule-check',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (check.value(); as c) {
      @if (c.problems.length || soon().length) {
        <section class="card flush" aria-labelledby="sched-title" id="schedule">
          <div class="card-head">
            <h2 id="sched-title">Schedule check</h2>
            <span class="muted small">next 6 weeks</span>
          </div>

          @if (changes().length) {
            <div class="changes">
              <h3>Clocks change</h3>
              <ul>
                @for (ch of changes(); track ch.timezone + ch.at) {
                  <li>
                    <strong>{{ ch.when }}</strong> · {{ ch.where }}: clocks go {{ ch.direction }}.
                  </li>
                }
              </ul>
              <p class="small muted">
                Lessons keep their time on the student's clock, so they move on Cairo's.
                @if (c.movedLessons) {
                  {{
                    c.movedLessons === 1
                      ? '1 upcoming lesson is'
                      : c.movedLessons + ' upcoming lessons are'
                  }}
                  at a different Cairo time than today. Teachers see the new time on Today and in
                  their calendar.
                } @else {
                  No booked lesson changes its Cairo time.
                }
              </p>
            </div>
          }

          @if (c.problems.length) {
            <ul class="list" aria-label="Lessons to fix">
              @for (p of c.problems; track p.lesson.id + p.kind) {
                <li>
                  <div class="what">
                    <strong>{{ cairo(p.lesson) }}</strong>
                    <span class="sub">{{ local(p.lesson) }}</span>
                    <span
                      ><a [routerLink]="['/admin/students', p.lesson.student.id]">{{
                        p.lesson.student.name
                      }}</a>
                      with {{ p.lesson.teacher.name }}</span
                    >
                    <span class="chip warn">{{ problem(p) }}</span>
                    @if (p.clockShiftMin) {
                      <span class="sub"
                        >{{ shift(p.clockShiftMin) }} on the Cairo clock than today, because of a
                        clock change</span
                      >
                    }
                  </div>
                  <button
                    type="button"
                    class="btn small"
                    [attr.aria-label]="'Change ' + p.lesson.student.name + ', ' + cairo(p.lesson)"
                    (click)="change.emit(p.lesson)"
                  >
                    Change
                  </button>
                </li>
              }
            </ul>
          } @else {
            <p class="ok small">No lesson clashes or falls outside a teacher's hours.</p>
          }
        </section>
      }
    }
  `,
  styles: `
    .changes {
      padding: 14px 18px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .changes h3 {
      margin: 0;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
    }
    .changes ul {
      margin: 0;
      padding-left: 18px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .changes p {
      margin: 0;
    }
    .list {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .list li {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 24px;
      justify-content: space-between;
      align-items: center;
      padding: 14px 18px;
      border-top: 1px solid var(--border);
    }
    .what {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .what .chip {
      align-self: flex-start;
    }
    .ok {
      margin: 0;
      padding: 12px 18px;
      border-top: 1px solid var(--border);
      color: var(--muted);
    }
  `,
})
export class ScheduleCheckPanel {
  /** Staff want to move or cancel this lesson. */
  readonly change = output<Lesson>();

  protected readonly check = httpResource<ScheduleCheck>(() => '/api/lessons/schedule-check');

  /** Changes in the next two weeks. */
  protected readonly soon = computed(() => {
    const limit = Date.now() + SOON_DAYS * 86_400_000;
    return (this.check.value()?.clockChanges ?? []).filter(
      (c) => new Date(c.at).getTime() <= limit,
    );
  });

  protected readonly changes = computed(() =>
    (this.check.value()?.clockChanges ?? []).map((c) => {
      const diff = c.offsetAfter - c.offsetBefore;
      const hours = Math.abs(diff) / 60;
      // The local day it happens on: the last moment on the old clock.
      const before = new Date(new Date(c.at).getTime() - 60_000);
      const where =
        c.timezone === ACADEMY_TZ
          ? 'Egypt (all teachers)'
          : `${city(c.timezone)} (${c.students === 1 ? '1 student' : `${c.students} students`})`;
      return {
        timezone: c.timezone,
        at: c.at,
        when: new Intl.DateTimeFormat('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          timeZone: c.timezone,
        }).format(before),
        where,
        direction: `${diff < 0 ? 'back' : 'forward'} ${hours === 1 ? '1 hour' : `${hours} hours`}`,
      };
    }),
  );

  reload() {
    this.check.reload();
  }

  protected cairo(l: Lesson) {
    return `${dayTime(l.startsAt, ACADEMY_TZ)} Cairo`;
  }
  protected local(l: Lesson) {
    return `${time(l.startsAt, l.student.timezone)} ${city(l.student.timezone)} for the student`;
  }
  protected shift(min: number) {
    const text = shiftText(min);
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  protected problem(p: Problem) {
    switch (p.kind) {
      case 'OUTSIDE_HOURS':
        return `Outside ${p.lesson.teacher.name}'s hours`;
      case 'TEACHER_CLASH':
        return `${p.lesson.teacher.name} also teaches ${p.with?.student.name ?? 'another student'} then`;
      case 'STUDENT_CLASH':
        return `${p.lesson.student.name} has another lesson then${p.with ? ` (with ${p.with.teacher.name})` : ''}`;
    }
  }
}
