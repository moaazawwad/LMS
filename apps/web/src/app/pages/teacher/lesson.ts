import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { ACADEMY_TZ, city, dayTime, shiftText, time, typeLabel } from '../../core/format';
import type { Lesson } from '../../core/models';
import { HomeworkFiles } from '../../shared/homework-files';
import { LessonStatus } from '../../shared/lesson-status';

@Component({
  selector: 'app-teacher-lesson',
  imports: [FormsModule, RouterLink, LessonStatus, HomeworkFiles],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (lesson.value(); as l) {
      <div class="page">
        <nav aria-label="Breadcrumb" class="muted">
          <a [routerLink]="isPast(l) ? '/teacher/history' : '/teacher/today'">{{
            isPast(l) ? 'Past lessons' : 'Today'
          }}</a>
          / {{ l.student.name }}
        </nav>
        <header class="page-head">
          <div>
            <h1>{{ l.student.name }} <app-lesson-status [lesson]="l" /></h1>
            <p>
              {{ when(l.startsAt) }} Cairo ({{ local(l) }}) · {{ l.curriculum }} · {{ type(l) }}
            </p>
            @if (l.clockShiftMin) {
              <p class="notice info">
                <span
                  >{{ moved(l) }}: the clocks change before this lesson, so it is at a different
                  Cairo time than usual. The student's time stays the same.</span
                >
              </p>
            }
          </div>
          <div class="head-actions">
            @if (askable(l)) {
              <a class="btn" [routerLink]="['/teacher/ask', l.id]"
                >Ask the academy to cancel or move</a
              >
            }
          </div>
        </header>
        <div class="cols">
          <form class="main" (ngSubmit)="save(l.id)">
            <section class="card">
              <div class="field">
                <label for="notes">What you covered</label>
                <span class="muted small">The student and the academy can read this.</span>
                <textarea
                  id="notes"
                  name="notes"
                  rows="5"
                  [ngModel]="notes()"
                  (ngModelChange)="notes.set($event)"
                ></textarea>
              </div>
            </section>
            <section class="card">
              <h2>Homework</h2>
              <div class="field">
                <label for="hw-title">Title</label>
                <input
                  id="hw-title"
                  name="hwTitle"
                  [ngModel]="homeworkTitle()"
                  (ngModelChange)="homeworkTitle.set($event)"
                />
              </div>
              <div class="field">
                <label for="hw-body">Instructions</label>
                <textarea
                  id="hw-body"
                  name="hwBody"
                  rows="4"
                  [ngModel]="homeworkBody()"
                  (ngModelChange)="homeworkBody.set($event)"
                ></textarea>
              </div>
            </section>
            <div>
              <button class="btn primary" type="submit" [disabled]="busy()">
                Save notes and homework
              </button>
            </div>
          </form>
          <aside class="side">
            @if (l.homeworkSentAt) {
              <section class="card" aria-labelledby="hw-answer-title">
                <h2 id="hw-answer-title">{{ l.student.name.split(' ')[0] }}'s homework</h2>
                <span class="muted small">Sent {{ when(l.homeworkSentAt) }} Cairo</span>
                <p class="pre answer">{{ l.homeworkAnswer }}</p>
                <app-homework-files [lessonId]="l.id" />
                <div class="field">
                  <label for="hw-feedback">{{
                    l.homeworkCheckedAt ? 'Your reply' : 'Reply to the student'
                  }}</label>
                  <textarea
                    id="hw-feedback"
                    rows="4"
                    maxlength="5000"
                    [value]="feedback()"
                    (input)="feedback.set($any($event.target).value)"
                  ></textarea>
                </div>
                @if (l.homeworkCheckedAt && feedback() === (l.homeworkFeedback ?? '')) {
                  <p class="muted small" role="status">
                    Sent to the student {{ when(l.homeworkCheckedAt) }} Cairo.
                  </p>
                } @else {
                  <div>
                    <button
                      type="button"
                      class="btn primary"
                      [disabled]="fbBusy() || !feedback().trim()"
                      (click)="reply(l.id)"
                    >
                      {{ fbBusy() ? 'Sending…' : 'Send reply' }}
                    </button>
                  </div>
                }
              </section>
            }
            <section class="card">
              <h2>Attendance</h2>
              <div class="row">
                <span>You entered class</span
                ><strong class="num">{{
                  l.teacherJoinedAt ? cairo(l.teacherJoinedAt) : '—'
                }}</strong>
              </div>
              <div class="row">
                <span>{{ l.student.name.split(' ')[0] }} entered class</span
                ><strong class="num">{{
                  l.studentJoinedAt ? cairo(l.studentJoinedAt) : '—'
                }}</strong>
              </div>
              <p class="muted small">{{ attendanceText(l) }}</p>
            </section>
          </aside>
        </div>
      </div>
    } @else {
      <p class="empty">{{ lesson.error() ? 'Lesson not found.' : 'Loading…' }}</p>
    }
  `,
  styles: `
    .row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }
    .small {
      font-size: 13px;
      margin: 0;
    }
    h1 app-lesson-status {
      vertical-align: middle;
      margin-left: 8px;
    }
    .head-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
    }
    .pre {
      white-space: pre-line;
      margin: 0;
    }
    .answer {
      background: var(--surface-muted);
      border: 1px solid var(--divider);
      border-radius: 10px;
      padding: 12px 14px;
    }
    textarea {
      width: 100%;
      resize: vertical;
      font: inherit;
    }
  `,
})
export class TeacherLesson {
  private readonly api = inject(ApiService);
  readonly id = input.required<string>();
  protected readonly lesson = httpResource<Lesson>(() => `/api/lessons/${this.id()}`);
  protected readonly notes = signal('');
  protected readonly homeworkTitle = signal('');
  protected readonly homeworkBody = signal('');
  protected readonly busy = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal('');
  /** Reply to the student's homework; starts from the one already sent. */
  protected readonly feedback = linkedSignal(() => this.lesson.value()?.homeworkFeedback ?? '');
  protected readonly fbBusy = signal(false);
  protected readonly fbError = signal('');

  protected async reply(id: string) {
    this.fbBusy.set(true);
    this.fbError.set('');
    try {
      this.lesson.set(await this.api.homeworkFeedback(id, this.feedback()));
    } catch (err) {
      this.fbError.set(errorMessage(err));
    } finally {
      this.fbBusy.set(false);
    }
  }

  constructor() {
    effect(() => {
      const l = this.lesson.value();
      if (!l) return;
      this.notes.set(l.notes ?? '');
      this.homeworkTitle.set(l.homeworkTitle ?? '');
      this.homeworkBody.set(l.homeworkBody ?? '');
    });
  }

  /** Still SCHEDULED and at most 7 days ago. */
  protected askable(l: Lesson) {
    return l.status === 'SCHEDULED' && new Date(l.startsAt).getTime() > Date.now() - 7 * 86_400_000;
  }

  protected isPast(l: Lesson) {
    return new Date(l.startsAt).getTime() + l.durationMin * 60_000 <= Date.now();
  }

  protected when(iso: string) {
    return dayTime(iso, ACADEMY_TZ);
  }
  protected cairo(iso: string) {
    return time(iso, ACADEMY_TZ);
  }
  protected local(l: Lesson) {
    return `${time(l.startsAt, l.student.timezone)} ${city(l.student.timezone)}`;
  }
  protected type(l: Lesson) {
    return typeLabel(l.type, l.extraReason);
  }

  protected async save(id: string) {
    this.busy.set(true);
    this.error.set('');
    this.saved.set(false);
    try {
      await this.api.saveNotes(id, {
        notes: this.notes(),
        homeworkTitle: this.homeworkTitle(),
        homeworkBody: this.homeworkBody(),
      });
      this.saved.set(true);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected moved(l: Lesson) {
    const text = shiftText(l.clockShiftMin);
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  /** What the presses mean for this lesson, and for the teacher's pay. */
  protected attendanceText(l: Lesson) {
    if (l.status === 'CANCELLED' || l.status === 'RESCHEDULED')
      return 'This lesson did not take place at this time.';
    const who =
      l.attendance ??
      (l.missed
        ? l.teacherJoinedAt
          ? 'TEACHER_ONLY'
          : l.studentJoinedAt
            ? 'STUDENT_ONLY'
            : 'NONE'
        : null);
    switch (who) {
      case 'BOTH':
        return 'The lesson is completed and counts for you.';
      case 'TEACHER_ONLY':
        return 'The student did not enter. The lesson still counts, and it counts for you.';
      case 'STUDENT_ONLY':
      case 'NONE':
        if (l.status === 'COMPLETED')
          return 'The academy recorded that nobody came. It does not count for you.';
        return 'You did not press Enter class, so this lesson does not count for you unless the academy marks it as held. If you taught it, tell the academy.';
      default:
        return 'When both press Enter class, the lesson is marked completed.';
    }
  }
}
