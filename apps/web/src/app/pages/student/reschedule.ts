import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { addDays, dayTime, localDate } from '../../core/format';
import type { FreeSlots, Lesson, StudentOverview } from '../../core/models';
import { ToastService } from '../../core/toast.service';

@Component({
  selector: 'app-student-reschedule',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <nav aria-label="Breadcrumb" class="muted">
        <a routerLink="/student/home">Home</a> / Reschedule
      </nav>
      @if (lesson.value(); as l) {
        <header>
          <h1>Move your lesson</h1>
          <p class="muted">
            {{ when(l.startsAt) }} with {{ l.teacher.name }}. Pick one of the teacher's free times.
            All times are {{ zone() }} time.
          </p>
        </header>
        <div class="cols">
          <section class="card main">
            <div class="dayhead">
              <h2>1. Pick a day</h2>
              <div class="weeks">
                <button
                  type="button"
                  class="btn small"
                  [disabled]="week() === 0"
                  (click)="week.set(week() - 1)"
                >
                  ‹ Earlier
                </button>
                <span class="muted small">{{
                  week() === 0 ? 'This week' : 'In ' + week() + (week() === 1 ? ' week' : ' weeks')
                }}</span>
                <button
                  type="button"
                  class="btn small"
                  [disabled]="week() === maxWeek"
                  (click)="week.set(week() + 1)"
                >
                  Later ›
                </button>
              </div>
            </div>
            <div class="days" role="group" aria-label="Day">
              @for (d of days(); track d.date) {
                <button
                  type="button"
                  [class.on]="date() === d.date"
                  [attr.aria-pressed]="date() === d.date"
                  (click)="pick(d.date)"
                >
                  <span>{{ d.dow }}</span
                  ><strong>{{ d.label }}</strong>
                </button>
              }
            </div>
            <h2>2. Pick a time</h2>
            <div class="slots" role="group" aria-label="Time">
              @for (s of slots.value()?.slots ?? []; track s.startsAt) {
                <button
                  type="button"
                  [class.on]="chosen() === s.startsAt"
                  [attr.aria-pressed]="chosen() === s.startsAt"
                  (click)="chosen.set(s.startsAt)"
                >
                  {{ s.local }}
                </button>
              } @empty {
                <p class="muted">
                  {{ slots.isLoading() ? 'Loading…' : 'No free time on this day.' }}
                </p>
              }
            </div>
          </section>
          <aside class="card side">
            <h2>Summary</h2>
            <div>
              <span class="muted small">From</span>
              <p class="strike">{{ when(l.startsAt) }}</p>
            </div>
            <div>
              <span class="muted small">To</span>
              <p class="to">{{ chosen() ? when(chosen()!) : 'Pick a day and time' }}</p>
            </div>
            @if (quotaText()) {
              <p class="notice warn">{{ quotaText() }}</p>
            }
            @if (done()) {
              <a class="btn primary" routerLink="/student/home">Back home</a>
            } @else {
              <button
                type="button"
                class="btn primary"
                [disabled]="!chosen() || busy()"
                (click)="confirm(l.id)"
              >
                {{ chosen() ? 'Confirm new time' : 'Pick a time first' }}
              </button>
            }
            <span class="muted small"
              >You can move a lesson yourself up to 4 hours before it starts.</span
            >
          </aside>
        </div>
      } @else {
        <p class="empty">{{ lesson.error() ? 'Lesson not found.' : 'Loading…' }}</p>
      }
    </div>
  `,
  styles: `
    header p {
      margin: 6px 0 0;
    }
    .days {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .days button {
      flex: 1 1 88px;
      min-height: 68px;
      border-radius: 12px;
      border: 1px solid var(--border-strong);
      background: #fff;
      font: inherit;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      cursor: pointer;
    }
    .days button span {
      font-size: 12px;
      opacity: 0.8;
    }
    .slots {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
      gap: 8px;
    }
    .slots button {
      min-height: 52px;
      border-radius: 10px;
      border: 1px solid var(--border-strong);
      background: #fff;
      font: inherit;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
    }
    button.on {
      border: 2px solid var(--primary) !important;
      background: var(--primary-tint) !important;
      color: var(--primary);
    }
    .small {
      font-size: 12px;
    }
    .strike {
      margin: 2px 0 0;
      color: var(--muted);
      text-decoration: line-through;
      font-weight: 600;
    }
    .to {
      margin: 2px 0 0;
      font-size: 17px;
      font-weight: 700;
    }
    .notice {
      margin: 0;
    }
    .dayhead {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .dayhead h2 {
      margin: 0;
    }
    .weeks {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .small {
      font-size: 13px;
    }
  `,
})
export class StudentReschedule {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  readonly id = input.required<string>();

  protected readonly lesson = httpResource<Lesson>(() => `/api/lessons/${this.id()}`);
  private readonly overview = httpResource<StudentOverview>(
    () => `/api/students/${this.auth.user()?.studentId}/overview`,
  );
  protected readonly zone = computed(
    () => this.lesson.value()?.student.timezone ?? this.auth.user()?.timezone ?? 'UTC',
  );
  protected readonly date = signal(
    addDays(localDate(new Date(), this.auth.user()?.timezone ?? 'UTC'), 1),
  );
  protected readonly chosen = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly done = signal<string | null>(null);
  private readonly toast = inject(ToastService);

  protected readonly slots = httpResource<FreeSlots>(() =>
    this.lesson.value()
      ? { url: `/api/lessons/${this.id()}/free-slots`, params: { date: this.date() } }
      : undefined,
  );

  /** 0 = the next 7 days; up to 4 weeks ahead, so a lesson can move into the next cycle too. */
  protected readonly week = signal(0);
  protected readonly maxWeek = 3;
  protected readonly days = computed(() => {
    const first = addDays(localDate(new Date(), this.zone()), this.week() * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(first, i);
      const noon = new Date(`${date}T12:00:00Z`);
      return {
        date,
        dow: new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(noon),
        label: new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        }).format(noon),
      };
    });
  });

  protected readonly quotaText = computed(() => {
    const o = this.overview.value();
    const q = o?.subscription?.plan.rescheduleQuota;
    if (q === null || q === undefined) return '';
    const used = o?.cycle?.reschedulesUsed ?? 0;
    return `This uses reschedule ${used + 1} of ${q} for this cycle.`;
  });

  protected when(iso: string) {
    return dayTime(iso, this.zone());
  }

  protected pick(date: string) {
    this.date.set(date);
    this.chosen.set(null);
  }

  protected async confirm(lessonId: string) {
    const startsAt = this.chosen();
    if (!startsAt) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.rescheduleLesson(lessonId, { startsAt });
      this.done.set(startsAt);
      this.toast.success(`Done. Your lesson is now ${this.when(startsAt)}.`);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
