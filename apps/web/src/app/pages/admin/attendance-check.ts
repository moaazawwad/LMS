import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { ACADEMY_TZ, city, dayTime, time } from '../../core/format';
import type { Lesson, ReviewOutcome } from '../../core/models';
import { ToastService } from '../../core/toast.service';

interface Choice {
  outcome: ReviewOutcome;
  teacherRemedy?: 'MAKEUP' | 'CREDIT';
  label: string;
  primary?: boolean;
}

/** Buttons for each recorded case, most likely answer first. */
const CHOICES: Record<ReviewOutcome, Choice[]> = {
  CONFIRM: [{ outcome: 'CONFIRM', label: 'OK, student absent', primary: true }],
  HELD: [{ outcome: 'HELD', label: 'It was held' }],
  STUDENT_ABSENT: [{ outcome: 'STUDENT_ABSENT', label: 'Student absent' }],
  NOBODY_CAME: [{ outcome: 'NOBODY_CAME', label: 'Nobody came' }],
  TEACHER_ABSENT: [
    {
      outcome: 'TEACHER_ABSENT',
      teacherRemedy: 'MAKEUP',
      label: 'Teacher absent · makeup',
      primary: true,
    },
    { outcome: 'TEACHER_ABSENT', teacherRemedy: 'CREDIT', label: 'Teacher absent · credit' },
  ],
};

const RECORDED: Record<string, string> = {
  TEACHER_ONLY: 'The teacher entered, the student did not',
  STUDENT_ONLY: 'The student entered, the teacher did not',
  NONE: 'Nobody pressed Enter class',
};

const PAY: Record<string, string> = {
  TEACHER_ONLY: 'Counted for the student · teacher paid',
  STUDENT_ONLY: 'Teacher not paid until you decide',
  NONE: 'Teacher not paid until you decide',
};

/**
 * Finished lessons someone did not enter. Staff say what happened; that
 * decides whether the lesson counts, whether the teacher is paid, and
 * whether the student gets a makeup or a credit.
 */
@Component({
  selector: 'app-attendance-check',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (list.value().length) {
      <section class="card flush" aria-labelledby="att-title" id="attendance">
        <div class="card-head">
          <h2 id="att-title">Attendance to check</h2>
          <span class="muted small"
            >{{ list.value().length }} {{ list.value().length === 1 ? 'lesson' : 'lessons' }}</span
          >
        </div>
        <ul class="list">
          @for (l of list.value(); track l.id) {
            <li>
              <div class="what">
                <strong>{{ when(l) }}</strong>
                <span class="sub">{{ local(l) }}</span>
                <span
                  ><a [routerLink]="['/admin/students', l.student.id]">{{ l.student.name }}</a> with
                  {{ l.teacher.name }}</span
                >
                <span class="chip warn">{{ recorded(l) }}</span>
                <span class="sub">{{ pay(l) }}</span>
              </div>
              <div class="do">
                <div
                  class="buttons"
                  role="group"
                  [attr.aria-label]="'What happened: ' + l.student.name + ', ' + when(l)"
                >
                  @for (c of choices(l); track c.label) {
                    <button
                      type="button"
                      class="btn small"
                      [class.primary]="c.primary"
                      [disabled]="busy()"
                      (click)="decide(l, c)"
                    >
                      {{ c.label }}
                    </button>
                  }
                </div>
              </div>
            </li>
          }
        </ul>
      </section>
    }
  `,
  styles: `
    .list {
      list-style: none;
      margin: 0;
      padding: 0;
      max-height: min(480px, 60vh);
      overflow-y: auto;
    }
    .list li {
      display: flex;
      flex-wrap: wrap;
      gap: 12px 24px;
      justify-content: space-between;
      padding: 14px 18px;
      border-top: 1px solid var(--border);
    }
    .what {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 220px;
    }
    .what .chip {
      align-self: flex-start;
    }
    .do {
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: flex-end;
      flex: 1 1 320px;
    }
    .note {
      width: 100%;
      max-width: 420px;
      position: relative;
    }
    .buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      justify-content: flex-end;
    }
    @media (max-width: 640px) {
      .do {
        align-items: stretch;
      }
      .note {
        max-width: none;
      }
      .buttons {
        justify-content: flex-start;
      }
    }
  `,
})
export class AttendanceCheck {
  private readonly api = inject(ApiService);
  /** Something changed: the page reloads its counts. */
  readonly changed = output<void>();

  protected readonly list = httpResource<Lesson[]>(() => '/api/lessons/attendance-review', {
    defaultValue: [],
  });
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  private readonly toast = inject(ToastService);

  protected choices(l: Lesson): Choice[] {
    const all = (l.reviewOptions ?? []).flatMap((o) => CHOICES[o]);
    // Nobody pressed anything: no answer is more likely than another.
    return l.attendance === 'NONE' ? all.map((c) => ({ ...c, primary: false })) : all;
  }
  protected recorded(l: Lesson) {
    return RECORDED[l.attendance ?? 'NONE'];
  }
  protected pay(l: Lesson) {
    return PAY[l.attendance ?? 'NONE'];
  }
  protected when(l: Lesson) {
    return `${dayTime(l.startsAt, ACADEMY_TZ)} Cairo`;
  }
  protected local(l: Lesson) {
    return `${time(l.startsAt, l.student.timezone)} ${city(l.student.timezone)} for the student`;
  }
  protected async decide(l: Lesson, c: Choice) {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.reviewAttendance(l.id, {
        outcome: c.outcome,
        teacherRemedy: c.teacherRemedy,
      });
      const who = `${l.student.name}, ${this.when(l)}`;
      // A makeup is owed: the message offers to book it.
      this.toast.success(
        `Saved for ${who}: ${c.label.toLowerCase()}.`,
        c.teacherRemedy === 'MAKEUP' && l.subscriptionId
          ? {
              label: 'Book the makeup',
              url: `/admin/students/${l.student.id}/add-lesson`,
              queryParams: { makeup: l.id },
            }
          : undefined,
      );
      this.list.reload();
      this.changed.emit();
    } catch (err) {
      this.error.set(errorMessage(err));
      this.list.reload();
    } finally {
      this.busy.set(false);
    }
  }
}
