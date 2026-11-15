import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { WEEKDAYS } from '../../core/format';
import { clockToMinutes, minutesToInput } from '../../core/forms';
import type { TeacherDetail } from '../../core/models';
import { ToastService } from '../../core/toast.service';

interface Row {
  start: string;
  end: string;
}

/** Saturday first, as the week runs in Egypt. */
const ORDER = [6, 7, 1, 2, 3, 4, 5];

/** Weekly open hours on the teacher's clock (Cairo). */
@Component({
  selector: 'app-admin-availability',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (teacher.value(); as t) {
      <div class="page">
        <nav aria-label="Breadcrumb" class="muted">
          <a routerLink="/admin/teachers">Teachers</a> /
          <a [routerLink]="['/admin/teachers', t.id]">{{ t.fullName }}</a> / Weekly hours
        </nav>
        @if (justCreated) {
          <!-- .notice is a flex row, so the sentence lives in one span -->
          <p class="notice ok" role="status">
            <span
              >{{ t.fullName }} was added.
              @if (tempPassword) {
                Their sign-in is {{ t.email }} with the temporary password
                <strong class="mono">{{ tempPassword }}</strong
                >. Send it to them now; it is not shown again.
              }
              Set the hours they can teach.</span
            >
          </p>
        }
        <header>
          <h1>Weekly hours</h1>
          <p class="muted">
            Cairo time. Lessons can only be booked or moved into these hours. An end time of 12:00
            AM means midnight.
          </p>
        </header>

        <section class="card narrow">
          @for (d of order; track d) {
            <div class="day">
              <span class="dname">{{ dayName(d) }}</span>
              <div class="rows">
                @for (r of rows()[d]; track $index; let i = $index) {
                  <div class="row">
                    <label class="sr-only" [attr.for]="'s-' + d + '-' + i"
                      >{{ dayName(d) }} from</label
                    >
                    <input
                      [id]="'s-' + d + '-' + i"
                      type="time"
                      step="900"
                      [value]="r.start"
                      (change)="set(d, i, 'start', $any($event.target).value)"
                    />
                    <span class="muted">to</span>
                    <label class="sr-only" [attr.for]="'e-' + d + '-' + i"
                      >{{ dayName(d) }} until</label
                    >
                    <input
                      [id]="'e-' + d + '-' + i"
                      type="time"
                      step="900"
                      [value]="r.end"
                      (change)="set(d, i, 'end', $any($event.target).value)"
                    />
                    <button
                      type="button"
                      class="btn small"
                      [attr.aria-label]="'Remove ' + dayName(d) + ' hours'"
                      (click)="remove(d, i)"
                    >
                      Remove
                    </button>
                  </div>
                } @empty {
                  <span class="muted off">Day off</span>
                }
              </div>
              <button
                type="button"
                class="btn small"
                [attr.aria-label]="'Add hours on ' + dayName(d)"
                (click)="add(d)"
              >
                Add hours
              </button>
            </div>
          }
          @if (outside(); as n) {
            <p class="notice warn" role="note" data-testid="outside-hours">
              <span
                >{{ n === 1 ? '1 booked lesson is' : n + ' booked lessons are' }} now outside these
                hours; booked lessons are not moved.
                <a routerLink="/admin/schedule-check">See them in the schedule check</a>
                or <a [routerLink]="['/admin/teachers', t.id]">go back to the teacher</a>.</span
              >
            </p>
          }
          <div class="actions">
            <button type="button" class="btn primary" [disabled]="busy()" (click)="save(t.id)">
              Save hours
            </button>
            <button type="button" class="btn" (click)="copyWeekdays()">
              Copy Saturday to every day
            </button>
          </div>
        </section>
      </div>
    } @else {
      <p class="empty">{{ teacher.error() ? 'Teacher not found.' : 'Loading…' }}</p>
    }
  `,
  styles: `
    .narrow {
      max-width: 820px;
      gap: 0;
    }
    .day {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      gap: 12px;
      padding: 14px 0;
      border-bottom: 1px solid var(--divider);
    }
    .dname {
      width: 56px;
      font-weight: 600;
      padding-top: 12px;
    }
    .rows {
      flex: 1 1 360px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .row input {
      min-height: 44px;
      padding: 0 10px;
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      font: inherit;
    }
    .off {
      padding-top: 12px;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding-top: 16px;
    }
    .notice {
      margin: 16px 0 0;
    }
    header p {
      margin: 6px 0 0;
    }
  `,
})
export class AdminAvailability {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  readonly id = input.required<string>();
  protected readonly justCreated = !!inject(ActivatedRoute).snapshot.queryParamMap.get('created');
  /** Handed over by the add-teacher form so staff can still copy it here. */
  protected readonly tempPassword =
    (this.router.currentNavigation()?.extras.state?.['password'] as string | undefined) ?? '';
  protected readonly teacher = httpResource<TeacherDetail>(() => `/api/teachers/${this.id()}`);
  protected readonly order = ORDER;
  protected readonly rows = signal<Record<number, Row[]>>({});
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  constructor() {
    effect(() => {
      const t = this.teacher.value();
      if (!t) return;
      const map: Record<number, Row[]> = {};
      for (const d of ORDER) map[d] = [];
      for (const w of t.availability)
        map[w.weekday].push({
          start: minutesToInput(w.startMinute),
          end: minutesToInput(w.endMinute),
        });
      this.rows.set(map);
    });
  }

  protected dayName(d: number) {
    return WEEKDAYS[d - 1];
  }

  protected add(d: number) {
    this.rows.update((m) => ({ ...m, [d]: [...(m[d] ?? []), { start: '14:00', end: '22:00' }] }));
  }

  protected remove(d: number, i: number) {
    this.rows.update((m) => ({ ...m, [d]: m[d].filter((_, j) => j !== i) }));
  }

  protected set(d: number, i: number, key: keyof Row, value: string) {
    this.rows.update((m) => ({
      ...m,
      [d]: m[d].map((r, j) => (j === i ? { ...r, [key]: value } : r)),
    }));
  }

  protected copyWeekdays() {
    const sat = this.rows()[6] ?? [];
    this.rows.update((m) => {
      const next = { ...m };
      for (const d of ORDER) next[d] = sat.map((r) => ({ ...r }));
      return next;
    });
  }

  /** after a save: booked lessons now outside the hours */
  protected readonly outside = signal(0);

  protected async save(teacherId: string) {
    this.error.set('');
    this.outside.set(0);
    const windows = [];
    for (const d of ORDER) {
      for (const r of this.rows()[d] ?? []) {
        if (!r.start || !r.end) continue;
        const startMinute = clockToMinutes(r.start);
        const endMinute = clockToMinutes(r.end, true);
        if (endMinute <= startMinute) {
          this.toast.error(
            `${this.dayName(d)}: each block must end after it starts. Split hours past midnight into the next day.`,
          );
          return;
        }
        windows.push({ weekday: d, startMinute, endMinute });
      }
    }
    this.busy.set(true);
    try {
      const res = await this.api.setAvailability(teacherId, windows);
      // Stay here to say so when booked lessons no longer fit.
      if (res.lessonsOutside) this.outside.set(res.lessonsOutside);
      else await this.router.navigate(['/admin/teachers', teacherId]);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
