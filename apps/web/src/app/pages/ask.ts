import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ACADEMY_TZ, city, dayTime, time } from '../core/format';
import type { Lesson, RequestKind } from '../core/models';
import { ToastService } from '../core/toast.service';

/**
 * A student or teacher asks the academy to cancel or move a lesson they
 * can't change online. Staff answer on their Requests page.
 */
@Component({
  selector: 'app-ask',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (lesson.value(); as l) {
      <div class="page">
        <nav aria-label="Breadcrumb" class="muted">
          <a [routerLink]="home">{{ homeLabel }}</a> / Ask the academy
        </nav>
        <header>
          <h1>Ask the academy</h1>
          <p class="muted">{{ lessonLine(l) }}</p>
        </header>

        @if (sent()) {
          <section class="card narrow">
            <p class="muted">Your message is with the academy.</p>
            <div>
              <a class="btn primary" [routerLink]="home">Back to {{ homeLabel.toLowerCase() }}</a>
            </div>
          </section>
        } @else {
          <form class="card narrow" (ngSubmit)="send(l)">
            <fieldset>
              <legend>What do you need?</legend>
              <div class="kinds">
                <label class="kind" [class.on]="kind() === 'CANCEL'" [class.off]="cancelBlocked()">
                  <input
                    type="radio"
                    name="kind"
                    value="CANCEL"
                    [checked]="kind() === 'CANCEL'"
                    [disabled]="cancelBlocked()"
                    (change)="kind.set('CANCEL')"
                  />
                  <span>
                    <strong>Cancel this lesson</strong>
                    <span class="muted">{{
                      cancelBlocked()
                        ? 'Not available: all cancellations for this month are used.'
                        : cancelHint
                    }}</span>
                    @if (cancelsText(); as t) {
                      <span class="muted">{{ t }}</span>
                    }
                  </span>
                </label>
                <label class="kind" [class.on]="kind() === 'RESCHEDULE'">
                  <input
                    type="radio"
                    name="kind"
                    value="RESCHEDULE"
                    [checked]="kind() === 'RESCHEDULE'"
                    (change)="kind.set('RESCHEDULE')"
                  />
                  <span
                    ><strong>Move it to another time</strong
                    ><span class="muted"
                      >The academy picks a time that suits you and the {{ other }}.</span
                    ></span
                  >
                </label>
              </div>
            </fieldset>

            <div class="field">
              <label for="ask-msg">Message</label>
              <textarea
                id="ask-msg"
                name="message"
                rows="4"
                maxlength="500"
                required
                [ngModel]="message()"
                (ngModelChange)="message.set($event)"
                placeholder="What happened? A sentence or two is enough."
              ></textarea>
            </div>
            @if (cancelBlocked()) {
              <p class="notice warn" role="status">
                <span
                  >You have used all {{ lesson.value()?.teacherCancels?.limit }} cancellations for
                  {{ lesson.value()?.teacherCancels?.month }}. You can still ask to move the lesson,
                  or call the academy if you really cannot teach it.</span
                >
              </p>
            }
            @if (kind() === 'RESCHEDULE') {
              <div class="field">
                <label for="ask-times"
                  >Times that suit you <span class="muted">(optional)</span></label
                >
                <input
                  id="ask-times"
                  name="times"
                  maxlength="200"
                  [ngModel]="times()"
                  (ngModelChange)="times.set($event)"
                  placeholder="e.g. any weekday after 5 PM"
                />
              </div>
            }

            <div class="actions">
              <button class="btn primary" type="submit" [disabled]="busy() || !message().trim()">
                Send request
              </button>
              <a class="btn" [routerLink]="home">Cancel</a>
            </div>
          </form>
        }
      </div>
    } @else {
      <p class="empty">{{ lesson.error() ? 'Lesson not found.' : 'Loading…' }}</p>
    }
  `,
  styles: `
    .narrow {
      max-width: 680px;
    }
    header p {
      margin: 6px 0 0;
    }
    fieldset {
      border: 0;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    legend {
      font-weight: 600;
      font-size: 14px;
      margin-bottom: 10px;
    }
    .kinds {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px;
    }
    .kind {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 14px;
      border: 1px solid var(--border-strong);
      border-radius: 12px;
      cursor: pointer;
    }
    .kind.on {
      border: 2px solid var(--primary);
      background: var(--primary-tint);
      padding: 13px;
    }
    .kind.off {
      opacity: 0.65;
      cursor: not-allowed;
    }
    .kind input {
      margin-top: 3px;
      width: 18px;
      height: 18px;
      accent-color: var(--primary);
    }
    .kind > span {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .kind .muted {
      font-size: 13px;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .notice {
      margin: 0;
    }
  `,
})
export class Ask {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  readonly lessonId = input.required<string>();
  private readonly isTeacher = this.auth.user()?.role === 'TEACHER';

  protected readonly home = this.isTeacher ? '/teacher/today' : '/student/home';
  protected readonly homeLabel = this.isTeacher ? 'Today' : 'Home';
  protected readonly other = this.isTeacher ? 'student' : 'teacher';
  protected readonly cancelHint = this.isTeacher
    ? 'The academy tells the student and arranges a makeup or a credit.'
    : 'Late or over-quota cancels usually still count as taken; the academy decides.';

  protected readonly lesson = httpResource<Lesson>(() => `/api/lessons/${this.lessonId()}`);
  protected readonly kind = signal<RequestKind>(
    inject(ActivatedRoute).snapshot.queryParamMap.get('kind') === 'move' ? 'RESCHEDULE' : 'CANCEL',
  );
  protected readonly message = signal('');
  protected readonly times = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly sent = signal(false);
  private readonly toast = inject(ToastService);

  /** Teachers: 4 cancellations a month (the lesson's month, Cairo). */
  protected readonly cancelBlocked = computed(() => {
    const tc = this.lesson.value()?.teacherCancels;
    return this.isTeacher && !!tc && tc.used >= tc.limit;
  });
  protected readonly cancelsText = computed(() => {
    const tc = this.lesson.value()?.teacherCancels;
    return this.isTeacher && tc
      ? `${tc.used} of ${tc.limit} cancellations used for ${tc.month}.`
      : '';
  });

  constructor() {
    // At the limit, a "cancel" link lands on asking to move instead.
    effect(() => {
      if (this.cancelBlocked() && untracked(this.kind) === 'CANCEL') this.kind.set('RESCHEDULE');
    });
  }

  protected readonly myZone = computed(() =>
    this.isTeacher ? ACADEMY_TZ : (this.lesson.value()?.student.timezone ?? 'UTC'),
  );

  protected lessonLine(l: Lesson) {
    if (this.isTeacher) {
      return `${dayTime(l.startsAt, ACADEMY_TZ)} Cairo (${time(l.startsAt, l.student.timezone)} in ${city(l.student.timezone)}) · ${l.student.name} · ${l.curriculum}`;
    }
    return `${dayTime(l.startsAt, this.myZone())} · with ${l.teacher.name} · ${l.curriculum}`;
  }

  protected async send(l: Lesson) {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.createRequest({
        lessonId: l.id,
        kind: this.kind(),
        message: this.message().trim(),
        preferredTimes: this.kind() === 'RESCHEDULE' ? this.times().trim() || undefined : undefined,
      });
      this.sent.set(true);
      this.toast.success(
        `Sent. The academy will answer soon; you'll see the answer on your ${this.homeLabel.toLowerCase()} page.`,
      );
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
