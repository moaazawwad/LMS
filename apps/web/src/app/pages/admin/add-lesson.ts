import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { addDays, dayTime, localDate, money, tierLabel, WEEKDAYS } from '../../core/format';
import { ruleError } from '../../core/forms';
import type {
  Curriculum,
  FreeSlots,
  Lesson,
  Plan,
  Slot,
  StudentDetail,
  SubscriptionDetail,
  TeacherRow,
} from '../../core/models';
import { hoursPerCycle, planForLessons } from '../../core/plans';
import { DateField } from '../../shared/date-field';
import { FreeTimes } from '../../shared/free-times';
import { resizeSlots, SlotEditor } from '../../shared/slot-editor';
import { AdminSubscribe } from './subscribe';
import { AdminTrial } from './trial';
import { ToastService } from '../../core/toast.service';

type Kind = 'one' | 'weekly' | 'trial';
type Who = 'same' | 'other';

/**
 * Add a lesson for a student, step by step: what kind (one lesson, every week,
 * free trial), with which teacher (theirs or another), then the curriculum and
 * time. The plan follows the weekly hours. Moving or cancelling a lesson, or
 * moving all lessons to another teacher, have their own actions.
 */
@Component({
  selector: 'app-admin-add-lesson',
  imports: [AdminSubscribe, AdminTrial, DateField, FormsModule, FreeTimes, RouterLink, SlotEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      @if (student.value(); as s) {
        <nav aria-label="Breadcrumb" class="muted">
          <a routerLink="/admin/students">Students</a> /
          <a [routerLink]="['/admin/students', s.id]">{{ s.fullName }}</a> / Add a lesson
        </nav>
        <header class="page-head">
          <div>
            <h1>Add a lesson</h1>
            <p>
              For {{ s.fullName }}. Times are on {{ first(s.fullName) }}'s clock ({{ s.timezone }}),
              with Cairo underneath.
            </p>
          </div>
        </header>

        <div class="steps">
          <section class="card step" aria-labelledby="st-kind">
            <h2 id="st-kind"><span class="num">1</span> What kind of lesson?</h2>
            <div class="choices" role="radiogroup" aria-labelledby="st-kind">
              @for (c of kinds(); track c.value) {
                <button
                  type="button"
                  role="radio"
                  class="choice"
                  [attr.aria-checked]="kind() === c.value"
                  [disabled]="c.disabled"
                  (click)="pickKind(c.value)"
                >
                  <strong>{{ c.title }}</strong>
                  <span>{{ c.text }}</span>
                </button>
              }
            </div>
            @if (!subs().length) {
              <p class="muted small">
                {{ first(s.fullName) }} has no weekly lessons yet, so a single lesson isn't
                possible: set up weekly lessons or book a free trial.
              </p>
            }
          </section>

          @if (kind() && kind() !== 'trial' && subs().length) {
            <section class="card step" aria-labelledby="st-who">
              <h2 id="st-who"><span class="num">2</span> With which teacher?</h2>
              @if (subs().length > 1) {
                <div class="field narrow-field">
                  <label for="al-sub">Their lessons</label>
                  <select id="al-sub" [ngModel]="subId()" (ngModelChange)="subId.set($event)">
                    @for (x of subs(); track x.id) {
                      <option [value]="x.id">{{ x.curriculum }} with {{ x.teacher.name }}</option>
                    }
                  </select>
                </div>
              }
              <div class="choices two" role="radiogroup" aria-labelledby="st-who">
                <button
                  type="button"
                  role="radio"
                  class="choice"
                  [attr.aria-checked]="who() === 'same'"
                  (click)="who.set('same')"
                >
                  <strong>Same teacher</strong>
                  <span>{{ current()?.teacher?.name }} · {{ current()?.curriculum }}</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  class="choice"
                  [attr.aria-checked]="who() === 'other'"
                  (click)="who.set('other')"
                >
                  <strong>Another teacher</strong>
                  <span>{{
                    kind() === 'one'
                      ? 'This one lesson only'
                      : 'New weekly lessons with them, next to the current ones'
                  }}</span>
                </button>
              </div>
            </section>
          }

          @if (kind() === 'trial') {
            <section class="card step" aria-labelledby="st-trial">
              <h2 id="st-trial"><span class="num">2</span> Free trial lesson</h2>
              <app-admin-trial [id]="s.id" [embedded]="true" />
            </section>
          } @else if (kind() === 'weekly' && (who() === 'other' || !subs().length)) {
            <section class="card step" aria-labelledby="st-new">
              <h2 id="st-new">
                <span class="num">{{ subs().length ? 3 : 2 }}</span>
                {{ subs().length ? 'New weekly lessons with another teacher' : 'Weekly lessons' }}
              </h2>
              <app-admin-subscribe [id]="s.id" [embedded]="true" />
            </section>
          } @else if (kind() === 'weekly' && who() === 'same' && sub.value(); as x) {
            <section class="card step" aria-labelledby="st-week">
              <h2 id="st-week"><span class="num">3</span> Add weekly lessons</h2>
              <p class="muted small">
                Now: {{ x.lessonsPerWeek }} a week · {{ slotText(x.slots) }} · {{ x.plan.name }}
              </p>
              <app-free-times
                [teacherId]="x.teacherId"
                [timezone]="x.timezone"
                [startDate]="freeFrom()"
                [durationMin]="x.plan.lessonMinutes"
                [(slots)]="newSlots"
              />
              <app-slot-editor
                [(slots)]="newSlots"
                [timezone]="x.timezone"
                [startDate]="freeFrom()"
              />
              <div class="choices two" role="radiogroup" aria-label="Starting">
                <button
                  type="button"
                  role="radio"
                  class="choice"
                  [attr.aria-checked]="applyNow()"
                  (click)="applyNow.set(true)"
                >
                  <strong>Starting now</strong>
                  <span>Added to this cycle and its invoice</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  class="choice"
                  [attr.aria-checked]="!applyNow()"
                  (click)="applyNow.set(false)"
                >
                  <strong>From the next cycle</strong>
                  <span>Starts {{ nextCycleStart() }}</span>
                </button>
              </div>
              @if (weeklyPlan(); as p) {
                <p class="summary" data-testid="weekly-summary">
                  {{ x.lessonsPerWeek + newSlots().length }} a week ·
                  {{ hours(x.lessonsPerWeek + newSlots().length, p) }} hours a cycle ·
                  <strong>{{ p.name }}</strong
                  >{{ p.id !== x.planId ? ' (was ' + x.plan.name + ')' : '' }} ·
                  {{ money((x.lessonsPerWeek + newSlots().length) * 4 * p.priceCents, p.currency) }}
                  a cycle
                </p>
              }
              <div class="actions">
                <button
                  type="button"
                  class="btn primary"
                  [disabled]="busy() || !newSlots().length"
                  (click)="addWeekly(x, false)"
                >
                  Add {{ newSlots().length === 1 ? 'weekly lesson' : 'weekly lessons' }}
                </button>
                @if (canOverride()) {
                  <button
                    type="button"
                    class="btn"
                    [disabled]="busy()"
                    (click)="addWeekly(x, true)"
                  >
                    Add anyway
                  </button>
                }
              </div>
            </section>
          } @else if (kind() === 'one' && sub.value(); as x) {
            <section class="card step" aria-labelledby="st-one">
              <h2 id="st-one"><span class="num">3</span> The lesson</h2>
              <div class="grid">
                @if (who() === 'other') {
                  <div class="field">
                    <label for="al-cur">Curriculum</label>
                    <select
                      id="al-cur"
                      [ngModel]="curriculumId()"
                      (ngModelChange)="curriculumId.set($event); teacherId.set('')"
                    >
                      @for (c of activeCurricula(); track c.id) {
                        <option [value]="c.id">{{ c.name }}</option>
                      }
                    </select>
                  </div>
                  <div class="field">
                    <label for="al-teacher">Teacher</label>
                    <select
                      id="al-teacher"
                      [ngModel]="teacherId()"
                      (ngModelChange)="teacherId.set($event)"
                    >
                      <option value="" disabled>Choose…</option>
                      @for (t of otherTeachers(); track t.id) {
                        <option [value]="t.id">{{ t.fullName }} · {{ tier(t.level) }}</option>
                      }
                    </select>
                    @if (!otherTeachers().length) {
                      <span class="muted small"
                        >No other active teacher teaches this curriculum.</span
                      >
                    }
                  </div>
                }
                <div class="field">
                  <label for="al-why">Why</label>
                  <select id="al-why" [ngModel]="reason()" (ngModelChange)="reason.set($event)">
                    <option value="OTHER">
                      Extra lesson ({{ money(x.plan.priceCents, x.plan.currency) }})
                    </option>
                    <option value="MAKEUP">Makeup for a missed lesson (free)</option>
                  </select>
                </div>
                @if (reason() === 'MAKEUP' && owed.value().length) {
                  <div class="field">
                    <label for="al-for">Replaces</label>
                    <select
                      id="al-for"
                      [ngModel]="replaces()"
                      (ngModelChange)="replaces.set($event)"
                    >
                      @for (o of owed.value(); track o.id) {
                        <option [value]="o.id">{{ owedText(o, x.timezone) }}</option>
                      }
                      <option value="">No particular lesson</option>
                    </select>
                  </div>
                }
                <div class="field">
                  <label for="al-date">Day ({{ x.timezone }})</label>
                  <app-date-field inputId="al-date" [min]="today()" [(value)]="date" />
                </div>
              </div>

              @if (oneTeacher()) {
                <div class="slots" role="group" aria-label="Free times that day">
                  @for (f of free.value()?.slots ?? []; track f.startsAt) {
                    <button
                      type="button"
                      class="slot"
                      [class.on]="chosen() === f.startsAt"
                      [attr.aria-pressed]="chosen() === f.startsAt"
                      (click)="chosen.set(f.startsAt)"
                    >
                      <strong>{{ f.local }}</strong
                      ><span>{{ f.cairo }} Cairo</span>
                    </button>
                  } @empty {
                    <p class="muted small">
                      {{
                        free.isLoading()
                          ? 'Checking the teacher’s free times…'
                          : 'No free time with this teacher that day. Try another day.'
                      }}
                    </p>
                  }
                </div>
              }
              <p class="muted small">
                {{
                  reason() === 'OTHER'
                    ? 'Billed at the plan price: on this cycle’s invoice while it is unpaid, otherwise the next one.'
                    : 'Not billed: it replaces a lesson already paid for.'
                }}
              </p>
              <div class="actions">
                <button
                  type="button"
                  class="btn primary"
                  [disabled]="busy() || !chosen() || !oneTeacher()"
                  (click)="addOne(x, false)"
                >
                  Add lesson
                </button>
                @if (canOverride()) {
                  <button type="button" class="btn" [disabled]="busy()" (click)="addOne(x, true)">
                    Add anyway
                  </button>
                }
              </div>
            </section>
          }
        </div>
      } @else {
        <p class="empty">{{ student.error() ? 'Student not found.' : 'Loading…' }}</p>
      }
    </div>
  `,
  styles: `
    .steps {
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-width: 860px;
    }
    .step {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .step h2 {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 16px;
      color: var(--ink);
    }
    .num {
      display: inline-grid;
      place-items: center;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: var(--primary-tint);
      color: var(--primary);
      font-size: 13px;
    }
    .choices {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }
    .choices.two {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    @media (max-width: 640px) {
      .choices,
      .choices.two {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .choice {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 14px 16px;
      border: 1px solid var(--border-strong);
      border-radius: 12px;
      background: var(--surface);
      font: inherit;
      text-align: start;
      cursor: pointer;
    }
    .choice span {
      font-size: 13px;
      color: var(--muted);
      line-height: 1.45;
    }
    .choice[aria-checked='true'] {
      border: 2px solid var(--primary);
      padding: 13px 15px;
      background: var(--primary-tint);
    }
    .choice:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
    }
    .narrow-field {
      max-width: 420px;
    }
    .slots {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
      gap: 8px;
    }
    .slot {
      min-height: 54px;
      border: 1px solid var(--border-strong);
      border-radius: 10px;
      background: var(--surface);
      font: inherit;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .slot span {
      font-size: 12px;
      color: var(--muted);
    }
    .slot.on {
      border: 2px solid var(--primary);
      background: var(--primary-tint);
      color: var(--primary);
    }
    .slots .muted {
      grid-column: 1 / -1;
    }
    .summary {
      margin: 0;
      padding: 10px 14px;
      border-radius: 10px;
      background: var(--surface-muted);
      border: 1px solid var(--border);
    }
    .small {
      font-size: 13px;
      margin: 0;
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
export class AdminAddLesson {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  readonly id = input.required<string>();
  /** ?kind=one|weekly|trial opens that kind */
  readonly kindParam = input<string | undefined>(undefined, { alias: 'kind' });
  /** ?makeup=<lesson id>: book the makeup for that missed lesson */
  readonly makeup = input<string | undefined>(undefined);
  /** ?subscription=<id>: which of their lessons */
  readonly subscription = input<string | undefined>(undefined);

  protected readonly student = httpResource<StudentDetail>(() => `/api/students/${this.id()}`);
  private readonly curricula = httpResource<Curriculum[]>(() => '/api/curricula', {
    defaultValue: [],
  });
  private readonly teachers = httpResource<TeacherRow[]>(() => '/api/teachers', {
    defaultValue: [],
  });
  private readonly plans = httpResource<Plan[]>(() => '/api/plans', { defaultValue: [] });

  protected readonly subs = computed(() =>
    (this.student.value()?.subscriptions ?? []).filter((x) => x.status === 'ACTIVE'),
  );
  protected readonly subId = linkedSignal(() => {
    const list = this.subs();
    return list.find((x) => x.id === this.subscription())?.id ?? list[0]?.id ?? '';
  });
  protected readonly current = computed(() => this.subs().find((x) => x.id === this.subId()));
  protected readonly sub = httpResource<SubscriptionDetail>(() =>
    this.subId() ? `/api/subscriptions/${this.subId()}` : undefined,
  );

  protected readonly kind = signal<Kind | null>(null);
  protected readonly who = signal<Who>('same');
  protected readonly kinds = computed(() => [
    {
      value: 'one' as Kind,
      title: 'One lesson',
      text: 'A single lesson on one day: an extra lesson or a makeup.',
      disabled: !this.subs().length,
    },
    {
      value: 'weekly' as Kind,
      title: 'Every week',
      text: 'Regular lessons at the same times. The plan follows the hours.',
      disabled: false,
    },
    {
      value: 'trial' as Kind,
      title: 'Free trial',
      text: 'One free lesson to start: no plan and no invoice.',
      disabled: false,
    },
  ]);

  // one lesson
  protected readonly reason = signal<'MAKEUP' | 'OTHER'>('OTHER');
  protected readonly curriculumId = linkedSignal(() => this.sub.value()?.curriculumId ?? '');
  protected readonly teacherId = signal('');
  protected readonly date = signal('');
  protected readonly chosen = signal<string | null>(null);
  protected readonly owed = httpResource<Lesson[]>(
    () =>
      this.kind() === 'one'
        ? { url: '/api/lessons/makeups-owed', params: { studentId: this.id() } }
        : undefined,
    { defaultValue: [] },
  );
  protected readonly replaces = linkedSignal(() => {
    const list = this.owed.value();
    return list.find((l) => l.id === this.makeup())?.id ?? list[0]?.id ?? '';
  });
  protected readonly activeCurricula = computed(() =>
    this.curricula.value().filter((c) => c.isActive),
  );
  protected readonly otherTeachers = computed(() =>
    this.teachers
      .value()
      .filter(
        (t) =>
          t.status === 'ACTIVE' &&
          t.id !== this.sub.value()?.teacherId &&
          t.curriculumIds.includes(this.curriculumId()),
      ),
  );
  /** The teacher of the one lesson: theirs, or the one picked. */
  protected readonly oneTeacher = computed(() =>
    this.who() === 'same' ? (this.sub.value()?.teacherId ?? '') : this.teacherId(),
  );
  protected readonly free = httpResource<FreeSlots>(() => {
    const x = this.sub.value();
    return this.kind() === 'one' && x && this.oneTeacher() && this.date()
      ? {
          url: '/api/lessons/trial-slots',
          params: {
            teacherId: this.oneTeacher(),
            studentId: this.id(),
            date: this.date(),
            durationMin: x.plan.lessonMinutes === 30 ? 30 : 60,
          },
        }
      : undefined;
  });

  // weekly with the same teacher
  protected readonly newSlots = signal<Slot[]>(resizeSlots([], 1));
  protected readonly applyNow = signal(true);
  protected readonly nextCycleStart = computed(() => {
    const cycles = this.sub.value()?.cycles ?? [];
    const last = cycles[cycles.length - 1];
    return last ? addDays(last.endDate, 1) : (this.sub.value()?.startDate ?? '');
  });
  protected readonly freeFrom = computed(() => {
    const x = this.sub.value();
    if (!x) return '';
    if (!this.applyNow()) return this.nextCycleStart();
    const today = localDate(new Date(), x.timezone);
    return today > x.startDate ? today : x.startDate;
  });
  protected readonly weeklyPlan = computed(() => {
    const x = this.sub.value();
    return x ? planForLessons(this.plans.value(), x.lessonsPerWeek + this.newSlots().length) : null;
  });

  protected readonly error = signal('');
  protected readonly canOverride = signal(false);
  protected readonly busy = signal(false);
  protected readonly done = signal('');
  protected readonly money = money;
  protected readonly tier = tierLabel;
  protected readonly today = computed(() => {
    const s = this.student.value();
    return s ? localDate(new Date(), s.timezone) : '';
  });

  constructor() {
    effect(() => {
      const k = this.kindParam();
      const m = this.makeup();
      untracked(() => {
        if (m) {
          this.kind.set('one');
          this.reason.set('MAKEUP');
        } else if (k === 'one' || k === 'weekly' || k === 'trial') this.kind.set(k);
      });
    });
    effect(() => {
      const s = this.student.value();
      if (s && !untracked(this.date)) this.date.set(addDays(localDate(new Date(), s.timezone), 1));
    });
    // A new day, teacher or kind clears the chosen time and any error.
    effect(() => {
      this.date();
      this.oneTeacher();
      this.kind();
      this.who();
      untracked(() => {
        this.chosen.set(null);
        this.error.set('');
        this.canOverride.set(false);
        this.done.set('');
      });
    });
  }

  protected first(name: string) {
    return name.split(' ')[0];
  }

  protected pickKind(k: Kind) {
    this.kind.set(k);
    if (k === 'trial') this.who.set('other');
    else this.who.set('same');
  }

  protected hours(n: number, p: Plan) {
    return hoursPerCycle(n, p.lessonMinutes);
  }

  protected slotText(slots: Slot[]) {
    return slots.map((x) => `${WEEKDAYS[x.weekday - 1]} ${x.startTime}`).join(' · ');
  }

  protected owedText(l: Lesson, tz: string) {
    return `${dayTime(l.startsAt, tz)} · ${l.teacher.name}`;
  }

  private async attempt(action: () => Promise<string>) {
    this.busy.set(true);
    this.error.set('');
    try {
      const msg = await action();
      this.toast.success(msg);
      await this.router.navigate(['/admin/students', this.id()]);
    } catch (err) {
      const e = ruleError(err);
      this.error.set(e.message);
      this.canOverride.set(e.canOverride);
    } finally {
      this.busy.set(false);
    }
  }

  protected addOne(x: SubscriptionDetail, override: boolean) {
    return this.attempt(async () => {
      const other = this.who() === 'other';
      const forLessonId = this.reason() === 'MAKEUP' ? this.replaces() || undefined : undefined;
      const res = await this.api.addExtraLesson({
        subscriptionId: x.id,
        startsAt: this.chosen()!,
        extraReason: this.reason(),
        forLessonId,
        teacherId: other ? this.teacherId() : undefined,
        curriculumId:
          other && this.curriculumId() !== x.curriculumId ? this.curriculumId() : undefined,
        override: override || undefined,
      });
      if (res.billing)
        return res.billing.pending
          ? 'Lesson added. It goes on the next invoice.'
          : `Lesson added to invoice ${res.billing.invoiceNumber}.`;
      return 'Makeup lesson added.';
    });
  }

  protected addWeekly(x: SubscriptionDetail, override: boolean) {
    return this.attempt(async () => {
      const existing = x.slots.map(({ weekday, startTime }) => ({ weekday, startTime }));
      const res = await this.api.updateSubscription(x.id, {
        slots: [...existing, ...this.newSlots()],
        applyNow: this.applyNow() || undefined,
        override: override || undefined,
      });
      const m = res.moved;
      if (!m) return 'Weekly lessons added from the next cycle.';
      return `Weekly lessons added: ${m.added} ${m.added === 1 ? 'lesson' : 'lessons'} this cycle${m.invoices.length ? ` (${m.invoices.join(', ')} updated)` : ''}.`;
    });
  }
}
