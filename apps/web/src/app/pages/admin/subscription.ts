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
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { addDays, localDate, money, tierLabel, WEEKDAYS } from '../../core/format';
import { ruleError } from '../../core/forms';
import type { Plan, Slot, SubscriptionDetail } from '../../core/models';
import { FreeTimes } from '../../shared/free-times';
import { SlotEditor } from '../../shared/slot-editor';
import { hoursPerCycle, planForLessons } from '../../core/plans';
import { ToastService } from '../../core/toast.service';
import { PageLog } from '../../shared/page-log';

type Section = 'plan' | 'pause';

interface FormState {
  error: string;
  canOverride: boolean;
  done: string;
}

const blank = (): FormState => ({ error: '', canOverride: false, done: '' });

/** Everything staff change on a running subscription. */
@Component({
  selector: 'app-admin-subscription',
  imports: [PageLog, FormsModule, RouterLink, SlotEditor, FreeTimes],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (sub.value(); as s) {
      <div class="page">
        <nav aria-label="Breadcrumb" class="muted">
          <a routerLink="/admin/students">Students</a> /
          <a [routerLink]="['/admin/students', s.studentId]">{{ s.student.user.fullName }}</a> /
          Subscription
        </nav>
        <header class="page-head">
          <div>
            <h1>
              {{ s.plan.name }} · {{ s.lessonsPerWeek }}/week
              <span
                class="chip"
                [class.ok]="s.status === 'ACTIVE'"
                [class.warn]="s.status === 'PAUSED'"
                >{{ s.status.toLowerCase() }}</span
              >
            </h1>
            <p>
              {{ s.curriculum.name }} with {{ s.teacher.user.fullName }} · {{ slotText(s.slots) }}
              {{ s.timezone }} · since {{ s.startDate }}
            </p>
          </div>
        </header>

        <div class="cols">
          <div class="main">
            @if (s.status === 'ACTIVE') {
              <section class="card">
                <button
                  type="button"
                  class="toggle"
                  [attr.aria-expanded]="open() === 'plan'"
                  (click)="toggle('plan')"
                >
                  <h2>Change weekly times (and plan)</h2>
                  <span class="muted">Now or from the next cycle</span>
                </button>
                @if (open() === 'plan') {
                  <div class="grid">
                    <div class="field">
                      <span class="label">Plan <span class="muted">(follows the hours)</span></span>
                      <p class="fixed" data-testid="auto-plan">
                        @if (newPlan(); as p) {
                          <span
                            ><strong>{{ p.name }}</strong> ·
                            {{ money(p.priceCents, p.currency) }}/lesson
                            @if (p.id !== s.planId) {
                              <span class="chip warn">was {{ s.plan.name }}</span>
                            }
                          </span>
                        }
                      </p>
                    </div>
                    <div class="field">
                      <span class="label">Lessons per week</span>
                      <p class="fixed">{{ weeklyText() }}</p>
                    </div>
                  </div>
                  <fieldset class="when">
                    <legend>Start the new times</legend>
                    <label
                      ><input
                        type="radio"
                        name="apply-when"
                        [checked]="applyNow()"
                        (change)="applyNow.set(true)"
                      />
                      Now: move the upcoming lessons of this cycle</label
                    >
                    <label
                      ><input
                        type="radio"
                        name="apply-when"
                        [checked]="!applyNow()"
                        (change)="applyNow.set(false)"
                      />
                      From the next cycle ({{ nextCycleStart() }})</label
                    >
                  </fieldset>
                  <app-free-times
                    [teacherId]="s.teacherId"
                    [timezone]="s.timezone"
                    [startDate]="freeFrom()"
                    [durationMin]="s.plan.lessonMinutes ?? 60"
                    [excludeSubscriptionId]="s.id"
                    [(slots)]="slots"
                  />
                  <app-slot-editor
                    [(slots)]="slots"
                    [timezone]="s.timezone"
                    [startDate]="freeFrom()"
                  />
                  <p class="muted small">
                    Add or remove days: the plan moves with the hours (Basic, Standard, Premium).
                    @if (applyNow()) {
                      The upcoming lessons move to the new times now. A day more adds extra lessons
                      to this cycle's invoice; a day less gives a credit for the lessons dropped.
                    } @else {
                      Lessons already booked stay as they are; the new times and price start on
                      {{ nextCycleStart() }}.
                    }
                  </p>

                  <div class="actions">
                    <button
                      type="button"
                      class="btn primary"
                      [disabled]="busy()"
                      (click)="savePlan(s, false)"
                    >
                      Save changes
                    </button>
                    @if (forms().plan.canOverride) {
                      <button
                        type="button"
                        class="btn"
                        [disabled]="busy()"
                        (click)="savePlan(s, true)"
                      >
                        Save anyway
                      </button>
                    }
                  </div>
                }
              </section>

              <section class="card links">
                <a class="btn" [routerLink]="['/admin/students', s.studentId, 'add-lesson']"
                  >Add a lesson</a
                >
                <a
                  class="btn"
                  [routerLink]="['/admin/students', s.studentId, 'transfer']"
                  [queryParams]="{ subscription: s.id }"
                  >Transfer</a
                >
              </section>

              <section class="card">
                <button
                  type="button"
                  class="toggle"
                  [attr.aria-expanded]="open() === 'pause'"
                  (click)="toggle('pause')"
                >
                  <h2>Pause</h2>
                  <span class="muted">Stops new cycles</span>
                </button>
                @if (open() === 'pause') {
                  <p class="small">
                    Upcoming lessons are cancelled by the academy and each one becomes a credit,
                    kept until the student comes back. Coming back = a new subscription.
                  </p>

                  <div class="actions">
                    <button type="button" class="btn danger" [disabled]="busy()" (click)="pause(s)">
                      Pause subscription
                    </button>
                  </div>
                }
              </section>
            } @else {
              <section class="card">
                <h2>This subscription is {{ s.status.toLowerCase() }}</h2>
                <p class="muted small">
                  To bring the student back, add weekly lessons again. Their first lesson will be
                  marked "Returning".
                </p>
                <div>
                  <a
                    class="btn primary"
                    [routerLink]="['/admin/students', s.studentId, 'add-lesson']"
                    [queryParams]="{ kind: 'weekly' }"
                    >Add weekly lessons</a
                  >
                </div>
              </section>
            }
          </div>

          <aside class="side">
            <section class="card flush">
              <div class="card-head"><h2>Cycles</h2></div>
              @for (c of cyclesDesc(); track c.id) {
                <div class="list-row">
                  <div class="grow">
                    <strong>Cycle {{ c.index }}</strong>
                    <span class="sub"
                      >{{ c.startDate }} – {{ c.endDate }} · {{ c.cancelsUsed }} cancel,
                      {{ c.reschedulesUsed }} reschedule</span
                    >
                  </div>
                  @if (c.invoice; as inv) {
                    <a
                      class="chip"
                      [routerLink]="['/admin/invoices', inv.id]"
                      [class.ok]="inv.status === 'PAID'"
                      [class.danger]="inv.status === 'OPEN'"
                      >{{ inv.number }} · {{ inv.status.toLowerCase() }}</a
                    >
                  }
                </div>
              }
            </section>
          </aside>
        </div>
        <app-page-log entityType="subscription" [entityId]="s.id" />
      </div>
    } @else {
      <p class="empty">{{ sub.error() ? 'Subscription not found.' : 'Loading…' }}</p>
    }
  `,
  styles: `
    .when {
      border: 0;
      padding: 0;
      margin: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 6px 18px;
    }
    .when legend {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 6px;
      width: 100%;
    }
    .when label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      cursor: pointer;
    }
    .pick {
      border: 0;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .pick legend {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .option {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 2px 10px;
      align-items: center;
      padding: 10px 12px;
      border: 1px solid var(--border-strong);
      border-radius: 10px;
      cursor: pointer;
    }
    .option.on {
      border-color: var(--primary);
      background: var(--primary-tint);
    }
    .option input {
      grid-row: span 2;
      margin: 0;
    }
    .option .fit {
      font-size: 13px;
      color: var(--warn);
    }
    .option .fit.good {
      color: var(--primary);
    }
    .free {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px 14px;
      border: 1px solid var(--divider);
      border-radius: 12px;
      background: var(--surface-muted);
    }
    .free p {
      margin: 0;
    }
    .night {
      display: flex;
      gap: 8px;
      align-items: center;
      color: var(--muted);
      cursor: pointer;
    }
    .night input {
      width: 16px;
      height: 16px;
    }
    .slots {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
      gap: 8px;
    }
    .slots button {
      min-height: 52px;
      border: 1px solid var(--border-strong);
      border-radius: 10px;
      background: #fff;
      font: inherit;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .slots button span {
      font-size: 12px;
      color: var(--muted);
    }
    .slots button.on {
      border: 2px solid var(--primary);
      background: var(--primary-tint);
      color: var(--primary);
    }
    .label {
      font-size: 14px;
      font-weight: 600;
    }
    .fixed {
      margin: 0;
      min-height: 40px;
      display: flex;
      align-items: center;
      color: var(--ink-2);
    }
    .toggle {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      width: 100%;
      padding: 0;
      border: 0;
      background: none;
      font: inherit;
      color: inherit;
      text-align: left;
      cursor: pointer;
      min-height: 32px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 14px;
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
    .grow {
      flex: 1 1 180px;
    }
    h1 .chip {
      vertical-align: middle;
      margin-left: 8px;
    }
  `,
})
export class AdminSubscription {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  readonly id = input.required<string>();

  protected readonly sub = httpResource<SubscriptionDetail>(
    () => `/api/subscriptions/${this.id()}`,
  );
  private readonly plans = httpResource<Plan[]>(() => '/api/plans', { defaultValue: [] });

  protected readonly open = signal<Section | null>(null);
  protected readonly busy = signal(false);
  protected readonly forms = signal<Record<Section, FormState>>({
    plan: blank(),
    pause: blank(),
  });

  /** Move the upcoming lessons now (default) or start the new times with the next cycle. */
  protected readonly applyNow = signal(true);
  /** Free times are checked from today when moving now, else from the next cycle. */
  protected readonly freeFrom = computed(() => {
    const s = this.sub.value();
    if (!s || !this.applyNow()) return this.nextCycleStart();
    const today = localDate(new Date(), s.timezone);
    return today > s.startDate ? today : s.startDate;
  });
  /** One weekly time per lesson; the plan follows the hours. */
  protected readonly lessonsPerWeek = computed(() => this.slots().length);
  /** Same count keeps the current plan (as the API does); a new count picks the plan for its hours. */
  protected readonly newPlan = computed(() => {
    const s = this.sub.value();
    if (!s) return null;
    if (this.lessonsPerWeek() === s.lessonsPerWeek) return s.plan;
    return planForLessons(this.plans.value(), this.lessonsPerWeek());
  });
  protected readonly weeklyText = computed(() => {
    const n = this.lessonsPerWeek();
    const p = this.newPlan();
    if (!p) return `${n} a week`;
    const hours = hoursPerCycle(n, p.lessonMinutes ?? 60);
    return `${n} a week · ${hours} hours a cycle · ${money(n * 4 * p.priceCents, p.currency)} a cycle`;
  });
  protected readonly slots = signal<Slot[]>([]);
  protected readonly money = money;
  protected readonly tier = tierLabel;
  protected readonly cyclesDesc = computed(() => [...(this.sub.value()?.cycles ?? [])].reverse());
  protected readonly nextCycleStart = computed(() => {
    const cycles = this.sub.value()?.cycles ?? [];
    const last = cycles[cycles.length - 1];
    return last ? addDays(last.endDate, 1) : (this.sub.value()?.startDate ?? '');
  });
  /** ?section=plan or pause opens that part */
  readonly section = input<string | undefined>(undefined);

  constructor() {
    effect(() => {
      const section = this.section();
      if (section === 'plan' || section === 'pause') untracked(() => this.open.set(section));
    });
    effect(() => {
      const s = this.sub.value();
      if (!s) return;
      this.slots.set(s.slots.map(({ weekday, startTime }) => ({ weekday, startTime })));
    });
  }
  protected slotText(slots: Slot[]) {
    return slots.map((x) => `${WEEKDAYS[x.weekday - 1]} ${x.startTime}`).join(' · ');
  }
  protected toggle(section: Section) {
    this.open.set(this.open() === section ? null : section);
  }

  private async run(section: Section, action: () => Promise<string>) {
    this.busy.set(true);
    this.forms.update((f) => ({ ...f, [section]: { ...f[section], error: '', done: '' } }));
    try {
      const done = await action();
      this.toast.success(done);
      this.forms.update((f) => ({ ...f, [section]: { ...blank(), done } }));
      this.sub.reload();
    } catch (err) {
      const e = ruleError(err);
      this.forms.update((f) => ({
        ...f,
        [section]: { ...f[section], error: e.message, canOverride: e.canOverride },
      }));
    } finally {
      this.busy.set(false);
    }
  }

  protected savePlan(s: SubscriptionDetail, override: boolean) {
    return this.run('plan', async () => {
      const res = await this.api.updateSubscription(s.id, {
        slots: this.slots(),
        applyNow: this.applyNow() || undefined,
        override: override || undefined,
      });
      const m = res.moved;
      if (!m) return 'Saved. The next cycle uses these times.';
      const parts = [`${m.moved} upcoming ${m.moved === 1 ? 'lesson' : 'lessons'} moved`];
      if (m.added) parts.push(`${m.added} added as extra`);
      if (m.dropped) parts.push(`${m.dropped} cancelled with a credit`);
      const inv = m.invoices.length ? ` (${m.invoices.join(', ')} updated)` : '';
      return `Saved: ${parts.join(', ')}${inv}.`;
    });
  }
  protected pause(s: SubscriptionDetail) {
    if (!confirm('Pause this subscription? Upcoming lessons become credits.')) return;
    return this.run('pause', async () => {
      const res = await this.api.pauseSubscription(s.id);
      return `Paused. ${res.lessonsCancelled} lessons became credits.`;
    });
  }
}
