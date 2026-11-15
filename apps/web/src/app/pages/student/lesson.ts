import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { dayTime, typeLabel } from '../../core/format';
import type { Lesson } from '../../core/models';
import { HomeworkFiles } from '../../shared/homework-files';
import { Icon } from '../../shared/icon';
import { LessonStatus } from '../../shared/lesson-status';

const NOTICE_MS = 4 * 3_600_000;

/** One lesson from the student's side: when, with whom, notes and homework. */
@Component({
  selector: 'app-student-lesson',
  imports: [RouterLink, LessonStatus, Icon, HomeworkFiles],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (lesson.value(); as l) {
      <div class="page">
        <nav aria-label="Breadcrumb" class="muted">
          <a routerLink="/student/lessons">Lessons</a> / {{ when(l.startsAt) }}
        </nav>
        <header class="page-head">
          <div>
            <h1>{{ when(l.startsAt) }} <app-lesson-status [lesson]="l" /></h1>
            <p>
              with {{ l.teacher.name }} · {{ l.curriculum }} · {{ type(l) }} ·
              {{ l.durationMin }} min
            </p>
          </div>
          @if (askable()) {
            <div class="actions">
              @if (changeable()) {
                <a class="btn" [routerLink]="['/student/reschedule', l.id]">Reschedule</a>
              }
              <a class="btn" [routerLink]="['/student/ask', l.id]">Ask the academy</a>
              @if (upcoming()) {
                <button
                  type="button"
                  class="btn primary"
                  [disabled]="!l.canEnter"
                  (click)="enter(l.id)"
                >
                  <app-icon name="video" [size]="18" [stroke]="2" /> Enter class
                </button>
              }
            </div>
          }
        </header>

        @if (l.status === 'RESCHEDULED') {
          <p class="notice warn">
            <span>This lesson was moved to another time. Your calendar shows the new one.</span>
          </p>
        } @else if (l.status === 'CANCELLED') {
          <p class="notice warn">
            <span>{{ cancelText(l) }}</span>
          </p>
        } @else if (absentText(l); as text) {
          <p class="notice warn">
            <span>{{ text }}</span>
          </p>
        }

        <div class="cols">
          <section class="card main">
            <h2>What you covered</h2>
            <p class="pre">
              {{
                l.notes ||
                  (upcoming()
                    ? 'Your teacher adds notes after the lesson.'
                    : 'Your teacher has not added notes yet.')
              }}
            </p>
          </section>
          <section class="card side">
            <h2>Homework</h2>
            @if (l.homeworkTitle || l.homeworkBody) {
              <strong>{{ l.homeworkTitle }}</strong>
              @if (l.homeworkBody) {
                <p class="pre">{{ l.homeworkBody }}</p>
              }
              <div class="answer">
                @if (l.homeworkCheckedAt) {
                  <h3>Your answer</h3>
                  <p class="pre">{{ l.homeworkAnswer }}</p>
                  <app-homework-files [lessonId]="l.id" />
                  <div class="feedback" role="note" aria-label="Your teacher's reply">
                    <strong>{{ l.teacher.name }} replied</strong>
                    <p class="pre">{{ l.homeworkFeedback }}</p>
                  </div>
                } @else {
                  <label for="hw-answer"
                    ><h3>{{ l.homeworkSentAt ? 'Your answer' : 'Send your answer' }}</h3></label
                  >
                  <textarea
                    id="hw-answer"
                    rows="5"
                    maxlength="5000"
                    [value]="answer()"
                    (input)="answer.set($any($event.target).value)"
                  ></textarea>
                  <app-homework-files [lessonId]="l.id" [canEdit]="true" />
                  @if (l.homeworkSentAt) {
                    <p class="muted small" role="status">
                      Sent {{ when(l.homeworkSentAt) }}. You can change it until
                      {{ l.teacher.name }} replies.
                    </p>
                  }
                  <div>
                    <button
                      type="button"
                      class="btn primary"
                      [disabled]="
                        hwBusy() || !answer().trim() || answer().trim() === (l.homeworkAnswer ?? '')
                      "
                      (click)="send(l.id)"
                    >
                      {{
                        hwBusy()
                          ? 'Sending…'
                          : l.homeworkSentAt
                            ? 'Send the new answer'
                            : 'Send to my teacher'
                      }}
                    </button>
                  </div>
                }
              </div>
            } @else {
              <p class="muted">No homework for this lesson.</p>
            }
          </section>
        </div>
      </div>
    } @else {
      <p class="empty">{{ lesson.error() ? 'Lesson not found.' : 'Loading…' }}</p>
    }
  `,
  styles: `
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    h1 app-lesson-status {
      vertical-align: middle;
      margin-left: 8px;
    }
    .pre {
      white-space: pre-line;
      margin: 0;
    }
    .answer {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-top: 12px;
      border-top: 1px solid var(--divider);
    }
    .answer h3 {
      margin: 0;
      font-size: 14px;
    }
    .answer textarea {
      width: 100%;
      resize: vertical;
      font: inherit;
    }
    .answer .small {
      font-size: 13px;
      margin: 0;
    }
    .feedback {
      background: var(--primary-tint);
      border-radius: 10px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .notice {
      margin: 0;
    }
  `,
})
export class StudentLesson {
  private readonly api = inject(ApiService);
  private readonly tz = inject(AuthService).user()?.timezone ?? 'UTC';
  readonly id = input.required<string>();
  protected readonly lesson = httpResource<Lesson>(() => `/api/lessons/${this.id()}`);
  protected readonly message = signal('');
  /** The answer being written; starts from what was sent. */
  protected readonly answer = linkedSignal(() => this.lesson.value()?.homeworkAnswer ?? '');
  protected readonly hwBusy = signal(false);
  protected readonly hwError = signal('');

  protected async send(id: string) {
    this.hwBusy.set(true);
    this.hwError.set('');
    try {
      this.lesson.set(await this.api.sendHomework(id, this.answer()));
    } catch (err) {
      this.hwError.set(errorMessage(err));
    } finally {
      this.hwBusy.set(false);
    }
  }

  protected readonly upcoming = computed(() => {
    const l = this.lesson.value();
    return (
      !!l &&
      l.status === 'SCHEDULED' &&
      new Date(l.startsAt).getTime() + l.durationMin * 60_000 > Date.now()
    );
  });
  /** Still SCHEDULED and at most 7 days ago: the academy can still cancel or move it. */
  protected readonly askable = computed(() => {
    const l = this.lesson.value();
    return (
      !!l &&
      l.status === 'SCHEDULED' &&
      new Date(l.startsAt).getTime() > Date.now() - 7 * 86_400_000
    );
  });
  /** The reschedule page checks the quota; here only the 4-hour notice. */
  protected readonly changeable = computed(() => {
    const l = this.lesson.value();
    return !!l && this.upcoming() && new Date(l.startsAt).getTime() - Date.now() >= NOTICE_MS;
  });

  protected when(iso: string) {
    return dayTime(iso, this.lesson.value()?.student.timezone ?? this.tz);
  }
  protected type(l: Lesson) {
    return typeLabel(l.type, l.extraReason);
  }
  /** After the lesson, when someone was not there. */
  protected absentText(l: Lesson) {
    const who =
      l.attendance ??
      (l.missed
        ? l.teacherJoinedAt
          ? 'TEACHER_ONLY'
          : l.studentJoinedAt
            ? 'STUDENT_ONLY'
            : 'NONE'
        : null);
    if (who === 'TEACHER_ONLY') return 'You did not enter this lesson. It counts as taken.';
    if (who === 'NONE' && l.status === 'COMPLETED')
      return 'Nobody entered this lesson. It counts as taken.';
    if ((who === 'STUDENT_ONLY' || who === 'NONE') && l.status === 'SCHEDULED') {
      return who === 'STUDENT_ONLY'
        ? 'Your teacher did not enter. The academy is checking and will arrange a makeup lesson or a credit.'
        : 'Nobody entered this lesson. The academy is checking what happened.';
    }
    return '';
  }

  protected cancelText(l: Lesson) {
    if (l.makeupOwed)
      return 'Your teacher could not make this lesson. The academy is booking a makeup lesson for you.';
    if (l.countedAsTaken) return 'This lesson was cancelled late, so it counts as taken.';
    if (l.cancelReason === 'BY_TEACHER')
      return 'Your teacher cancelled this lesson. The academy arranges a makeup lesson or a credit.';
    if (l.cancelReason === 'UNPAID')
      return 'This lesson was cancelled because the invoice was not paid.';
    return 'This lesson was cancelled. It comes off your next invoice.';
  }

  protected async enter(id: string) {
    this.message.set('');
    try {
      const { zoomLink } = await this.api.enterClass(id);
      if (zoomLink) window.open(zoomLink, '_blank', 'noopener');
      this.lesson.reload();
    } catch (err) {
      this.message.set(errorMessage(err));
    }
  }
}
