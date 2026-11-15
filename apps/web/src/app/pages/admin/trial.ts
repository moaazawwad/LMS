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
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { addDays, localDate, tierLabel } from '../../core/format';
import { ruleError } from '../../core/forms';
import type { Curriculum, FreeSlots, StudentDetail, TeacherRow } from '../../core/models';
import { DateField } from '../../shared/date-field';
import { ToastService } from '../../core/toast.service';

/**
 * Book a free trial lesson: one time only, no subscription and no invoice.
 * Pick the curriculum, the teacher, the length and one of the teacher's free times.
 */
@Component({
  selector: 'app-admin-trial',
  imports: [FormsModule, RouterLink, DateField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      @if (student.value(); as s) {
        @if (!embedded()) {
          <nav aria-label="Breadcrumb" class="muted">
            <a routerLink="/admin/students">Students</a> /
            <a [routerLink]="['/admin/students', s.id]">{{ s.fullName }}</a> / Trial lesson
          </nav>
          <header class="page-head">
            <div>
              <h1>Free trial lesson</h1>
              <p>
                One lesson, free: no subscription and no invoice. Times are on
                {{ first(s.fullName) }}'s clock ({{ s.timezone }}).
              </p>
            </div>
          </header>
        }
        <section class="narrow" [class.card]="!embedded()">
          <div class="grid">
            <div class="field">
              <label for="t-cur">Curriculum</label>
              <select
                id="t-cur"
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
              <label for="t-teacher">Teacher</label>
              <select
                id="t-teacher"
                [disabled]="!curriculumId()"
                [ngModel]="teacherId()"
                (ngModelChange)="teacherId.set($event)"
              >
                <option value="" disabled>
                  {{ curriculumId() ? 'Choose…' : 'Pick a curriculum first' }}
                </option>
                @for (t of teacherOptions(); track t.id) {
                  <option [value]="t.id">{{ t.fullName }} · {{ tier(t.level) }}</option>
                }
              </select>
            </div>
            <div class="field">
              <label for="t-len">Length</label>
              <select id="t-len" [ngModel]="duration()" (ngModelChange)="duration.set(+$event)">
                <option [value]="60">60 minutes</option>
                <option [value]="30">30 minutes</option>
              </select>
            </div>
            <div class="field">
              <label for="t-date">Day ({{ s.timezone }})</label>
              <app-date-field inputId="t-date" [min]="today()" [(value)]="date" />
            </div>
          </div>

          @if (teacherId() && date()) {
            <div class="slots" role="group" [attr.aria-label]="'Free times that day'">
              @for (f of slots.value()?.slots ?? []; track f.startsAt) {
                <button
                  type="button"
                  class="slot"
                  [class.on]="chosen() === f.startsAt"
                  [attr.aria-pressed]="chosen() === f.startsAt"
                  (click)="chosen.set(f.startsAt)"
                >
                  {{ f.local }} <span>{{ f.cairo }} Cairo</span>
                </button>
              } @empty {
                <p class="muted">
                  {{
                    slots.isLoading()
                      ? 'Checking the teacher’s free times…'
                      : 'No free time with this teacher that day. Try another day.'
                  }}
                </p>
              }
            </div>
          }

          <div class="actions">
            <button
              type="button"
              class="btn primary"
              [disabled]="busy() || !ready()"
              (click)="book(s.id, false)"
            >
              Book trial lesson
            </button>
            @if (canOverride()) {
              <button type="button" class="btn" [disabled]="busy()" (click)="book(s.id, true)">
                Book anyway
              </button>
            }
            @if (!embedded()) {
              <a class="btn" [routerLink]="['/admin/students', s.id]">Cancel</a>
            }
          </div>
        </section>
      } @else {
        <p class="empty">{{ student.error() ? 'Student not found.' : 'Loading…' }}</p>
      }
    </div>
  `,
  styles: `
    .narrow {
      max-width: 820px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
    }
    .slots {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .slot {
      padding: 8px 12px;
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      background: var(--surface, #fff);
      font: inherit;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
    }
    .slot span {
      font-size: 12px;
      font-weight: 400;
      color: var(--muted);
    }
    .slot.on {
      border-color: var(--primary);
      background: var(--primary-tint);
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
export class AdminTrial {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  readonly id = input.required<string>();
  /** inside "Add a lesson": no page title or breadcrumb */
  readonly embedded = input(false);

  protected readonly student = httpResource<StudentDetail>(() => `/api/students/${this.id()}`);
  private readonly curricula = httpResource<Curriculum[]>(() => '/api/curricula', {
    defaultValue: [],
  });
  private readonly teachers = httpResource<TeacherRow[]>(() => '/api/teachers', {
    defaultValue: [],
  });

  protected readonly curriculumId = signal('');
  protected readonly teacherId = signal('');
  protected readonly duration = signal(60);
  protected readonly date = signal('');
  protected readonly chosen = signal<string | null>(null);
  protected readonly error = signal('');
  protected readonly canOverride = signal(false);
  protected readonly busy = signal(false);
  protected readonly tier = tierLabel;

  protected readonly today = computed(() => {
    const s = this.student.value();
    return s ? localDate(new Date(), s.timezone) : '';
  });
  protected readonly activeCurricula = computed(() =>
    this.curricula.value().filter((c) => c.isActive),
  );
  protected readonly teacherOptions = computed(() =>
    this.teachers
      .value()
      .filter((t) => t.status === 'ACTIVE' && t.curriculumIds.includes(this.curriculumId())),
  );
  protected readonly slots = httpResource<FreeSlots>(() =>
    this.teacherId() && this.date()
      ? {
          url: '/api/lessons/trial-slots',
          params: {
            teacherId: this.teacherId(),
            studentId: this.id(),
            date: this.date(),
            durationMin: this.duration(),
          },
        }
      : undefined,
  );
  protected readonly ready = computed(
    () => !!(this.curriculumId() && this.teacherId() && this.chosen()),
  );

  constructor() {
    // Tomorrow on the student's clock to start with.
    effect(() => {
      const s = this.student.value();
      if (s && !untracked(this.date)) this.date.set(addDays(localDate(new Date(), s.timezone), 1));
    });
    // A new day, teacher or length clears the chosen time.
    effect(() => {
      this.teacherId();
      this.date();
      this.duration();
      untracked(() => {
        this.chosen.set(null);
        this.error.set('');
        this.canOverride.set(false);
      });
    });
  }

  protected first(name: string) {
    return name.split(' ')[0];
  }

  protected async book(studentId: string, override: boolean) {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.bookTrial({
        studentId,
        teacherId: this.teacherId(),
        curriculumId: this.curriculumId(),
        startsAt: this.chosen()!,
        durationMin: this.duration(),
        override: override || undefined,
      });
      this.toast.success('Trial lesson booked: free, without an invoice.');
      await this.router.navigate(['/admin/students', studentId]);
    } catch (err) {
      const e = ruleError(err);
      this.error.set(e.message);
      this.canOverride.set(e.canOverride);
    } finally {
      this.busy.set(false);
    }
  }
}
