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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { addDays, localDate, money, tierLabel } from '../../core/format';
import { ruleError } from '../../core/forms';
import type { Curriculum, Plan, Slot, StudentDetail, TeacherRow, Tier } from '../../core/models';
import { planSummary } from '../../core/plans';
import { FreeTimes } from '../../shared/free-times';
import { resizeSlots, SlotEditor } from '../../shared/slot-editor';
import { DateField } from '../../shared/date-field';
import { ToastService } from '../../core/toast.service';

const RANK: Record<Tier, number> = { BASIC: 1, STANDARD: 2, PREMIUM: 3 };

/** New subscription for a student: teacher, curriculum, plan and weekly times. */
@Component({
  selector: 'app-admin-subscribe',
  imports: [DateField, FormsModule, RouterLink, SlotEditor, FreeTimes],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      @if (student.value(); as s) {
        @if (!embedded()) {
          <nav aria-label="Breadcrumb" class="muted">
            <a routerLink="/admin/students">Students</a> /
            <a [routerLink]="['/admin/students', s.id]">{{ s.fullName }}</a> / New subscription
          </nav>
        }
        @if (justCreated) {
          <!-- .notice is a flex row, so the sentence lives in one span -->
          <p class="notice ok" role="status">
            <span
              >{{ s.fullName }} was added.
              @if (tempPassword) {
                Their sign-in is {{ s.email }} with the temporary password
                <strong class="mono">{{ tempPassword }}</strong
                >. Send it to them now; it is not shown again.
              }
              Now book their lessons.</span
            >
          </p>
        }
        @if (!embedded()) {
          <h1>New subscription</h1>
        }

        <form class="narrow" [class.card]="!embedded()" (ngSubmit)="save(s)">
          <div class="grid">
            <div class="field">
              <label for="f-cur">Curriculum</label>
              <select
                id="f-cur"
                name="curriculum"
                required
                [ngModel]="curriculumId()"
                (ngModelChange)="curriculumId.set($event); teacherId.set('')"
              >
                <option value="" disabled>Choose…</option>
                @for (c of activeCurricula(); track c.id) {
                  <option [value]="c.id">{{ c.name }}</option>
                }
              </select>
            </div>
            <div class="field">
              <span class="label">Plan <span class="muted">(follows the hours)</span></span>
              <p class="fixed" data-testid="auto-plan">
                @if (summary(); as x) {
                  <span
                    ><strong>{{ x.plan.name }}</strong> ·
                    {{ money(x.plan.priceCents, x.plan.currency) }}/lesson ·
                    {{ quotaText(x.plan) }}</span
                  >
                } @else {
                  No active plan: add one under Curricula &amp; plans.
                }
              </p>
            </div>
          </div>

          <div class="field">
            <label for="f-teacher">Teacher</label>
            <select
              id="f-teacher"
              name="teacher"
              required
              [ngModel]="teacherId()"
              (ngModelChange)="teacherId.set($event)"
              [disabled]="!curriculumId()"
            >
              <option value="" disabled>
                {{ curriculumId() ? 'Choose…' : 'Pick a curriculum first' }}
              </option>
              @for (t of teacherOptions(); track t.id) {
                <option [value]="t.id">
                  {{ t.fullName }} · {{ tier(t.level)
                  }}{{
                    t.fit === 'LOWER'
                      ? ' · below the plan level (needs override)'
                      : t.fit === 'HIGHER'
                        ? ' · higher level'
                        : ''
                  }}
                </option>
              }
            </select>
            @if (curriculumId() && !teacherOptions().length) {
              <span class="muted small">No active teacher teaches this curriculum yet.</span>
            }
          </div>

          <div class="grid">
            <div class="field">
              <span class="label">Lessons per week</span>
              <p class="fixed">{{ weeklyText() }}</p>
            </div>
            <div class="field">
              <label for="f-start">First day of cycle 1 ({{ s.timezone }})</label>
              <app-date-field inputId="f-start" [(value)]="startDate" />
            </div>
          </div>

          <div class="field">
            <span class="label"
              >Weekly times on {{ s.fullName.split(' ')[0] }}'s clock ({{ s.timezone }})</span
            >
            @if (teacherId() && startDate()) {
              <app-free-times
                [teacherId]="teacherId()"
                [timezone]="s.timezone"
                [startDate]="startDate()"
                [durationMin]="lessonMinutes()"
                [(slots)]="slots"
              />
            }
            <app-slot-editor [(slots)]="slots" [timezone]="s.timezone" [startDate]="startDate()" />
          </div>

          <div class="actions">
            <button class="btn primary" type="submit" [disabled]="busy() || !ready()">
              {{ embedded() ? 'Add weekly lessons' : 'Create subscription' }}
            </button>
            @if (canOverride()) {
              <button class="btn" type="button" [disabled]="busy()" (click)="save(s, true)">
                Add anyway
              </button>
            }
            @if (!embedded()) {
              <a class="btn" [routerLink]="['/admin/students', s.id]">Cancel</a>
            }
          </div>
          <p class="muted small">Creates cycle 1 with its lessons and the prepaid invoice.</p>
        </form>
      } @else {
        <p class="empty">{{ student.error() ? 'Student not found.' : 'Loading…' }}</p>
      }
    </div>
  `,
  styles: `
    .narrow {
      max-width: 820px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 14px;
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
export class AdminSubscribe {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  readonly id = input.required<string>();
  /** inside "Add a lesson": no page title or breadcrumb */
  readonly embedded = input(false);
  protected readonly justCreated = !!inject(ActivatedRoute).snapshot.queryParamMap.get('created');
  /** Handed over by the add-student form so staff can still copy it here. */
  protected readonly tempPassword =
    (this.router.currentNavigation()?.extras.state?.['password'] as string | undefined) ?? '';

  protected readonly student = httpResource<StudentDetail>(() => `/api/students/${this.id()}`);
  private readonly curricula = httpResource<Curriculum[]>(() => '/api/curricula', {
    defaultValue: [],
  });
  private readonly plans = httpResource<Plan[]>(() => '/api/plans', { defaultValue: [] });
  private readonly teachers = httpResource<TeacherRow[]>(() => '/api/teachers', {
    defaultValue: [],
  });

  protected readonly curriculumId = signal('');
  protected readonly teacherId = signal('');
  /** One weekly time per lesson; add or remove days freely. */
  protected readonly lessonsPerWeek = computed(() => this.slots().length);
  /** The plan follows the hours: Basic 4 h, Standard 8 h, Premium 12 h a cycle. */
  protected readonly summary = computed(() =>
    planSummary(this.plans.value(), this.lessonsPerWeek()),
  );
  private readonly plan = computed(() => this.summary()?.plan ?? null);
  protected readonly weeklyText = computed(() => {
    const x = this.summary();
    const n = this.lessonsPerWeek();
    if (!x) return `${n} a week`;
    return `${n} ${n === 1 ? 'lesson' : 'lessons'} of ${x.plan.lessonMinutes} min a week · ${x.hours} hours per 28-day cycle · ${money(x.cycleCents, x.plan.currency)} a cycle`;
  });
  protected readonly startDate = signal('');
  protected readonly slots = signal<Slot[]>(resizeSlots([], 1));
  protected readonly error = signal('');
  protected readonly canOverride = signal(false);
  protected readonly busy = signal(false);

  protected readonly money = money;
  protected readonly tier = tierLabel;
  protected readonly activeCurricula = computed(() =>
    this.curricula.value().filter((c) => c.isActive),
  );
  protected readonly activePlans = computed(() => this.plans.value().filter((p) => p.isActive));
  protected readonly lessonMinutes = computed(() => this.plan()?.lessonMinutes ?? 60);

  /** Teachers of the chosen curriculum: same level first, then higher, then lower. */
  protected readonly teacherOptions = computed(() => {
    const plan = this.plan();
    return this.teachers
      .value()
      .filter((t) => t.status === 'ACTIVE' && t.curriculumIds.includes(this.curriculumId()))
      .map((t) => {
        const diff = plan ? RANK[t.level] - RANK[plan.tier] : 0;
        return { ...t, diff, fit: diff === 0 ? 'MATCH' : diff > 0 ? 'HIGHER' : 'LOWER' };
      })
      .sort((a, b) => (a.diff === 0 ? -1 : b.diff === 0 ? 1 : b.diff - a.diff));
  });

  protected readonly ready = computed(
    () =>
      !!(
        this.curriculumId() &&
        this.plan() &&
        this.teacherId() &&
        this.startDate() &&
        this.slots().length
      ),
  );

  constructor() {
    effect(() => {
      const s = this.student.value();
      if (s && !untracked(this.startDate))
        this.startDate.set(addDays(localDate(new Date(), s.timezone), 1));
    });
  }

  protected quotaText(p: Plan) {
    if (p.cancelQuota === null && p.rescheduleQuota === null) return 'unlimited changes';
    return `${p.cancelQuota ?? '∞'} cancel / ${p.rescheduleQuota ?? '∞'} reschedule per cycle`;
  }

  protected async save(s: StudentDetail, override = false) {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.createSubscription({
        studentId: s.id,
        teacherId: this.teacherId(),
        curriculumId: this.curriculumId(),
        startDate: this.startDate(),
        slots: this.slots(),
        override: override || undefined,
      });
      this.toast.success('Weekly lessons added, with the first invoice.');
      await this.router.navigate(['/admin/students', s.id]);
    } catch (err) {
      const e = ruleError(err);
      this.error.set(e.message);
      this.canOverride.set(e.canOverride);
    } finally {
      this.busy.set(false);
    }
  }
}
