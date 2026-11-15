import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { ACADEMY_TZ, city, day, money, time, tierLabel, typeLabel } from '../../core/format';
import type { AcademyStats, Lesson } from '../../core/models';
import { LessonActionDialog } from '../../shared/lesson-action-dialog';
import { LessonStatus } from '../../shared/lesson-status';
import { AttendanceCheck } from './attendance-check';
import { ToastService } from '../../core/toast.service';
import { PageLog } from '../../shared/page-log';

type Filter = 'all' | 'upcoming' | 'done' | 'cancelled';

@Component({
  selector: 'app-admin-today',
  imports: [PageLog, RouterLink, LessonStatus, LessonActionDialog, AttendanceCheck],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <h1>Today</h1>
          <p>{{ today }} · Cairo time · student times in their own zone</p>
        </div>
      </header>

      @if (openRequests.value()?.open; as n) {
        <p class="notice info" role="status">
          <span
            >{{ n === 1 ? '1 request is' : n + ' requests are' }} waiting for an answer.
            <a routerLink="/admin/requests">Open requests</a></span
          >
        </p>
      }

      <section class="stats" aria-label="Today at a glance">
        <div class="stat">
          <span>Lessons today</span><span>{{ counts().all }}</span>
        </div>
        <div class="stat">
          <span>Live now</span><span style="color: var(--primary)">{{ counts().live }}</span>
        </div>
        <div class="stat">
          <span>Completed</span><span>{{ counts().done }}</span>
        </div>
        <div class="stat">
          <span>Cancelled</span><span>{{ counts().cancelled }}</span>
        </div>
      </section>

      @if (scheduleProblems(); as n) {
        <p class="notice warn" role="status">
          <span
            >{{ n === 1 ? '1 upcoming lesson needs' : n + ' upcoming lessons need' }} attention
            (outside the teacher's hours or clashing).
            <a routerLink="/admin/schedule-check">Review</a></span
          >
        </p>
      }

      <section class="card flush" aria-labelledby="lessons-title">
        <div class="card-head">
          <h2 id="lessons-title">Lessons</h2>
          <div role="group" aria-label="Filter lessons" class="filters">
            @for (f of filters; track f.id) {
              <button
                type="button"
                class="btn small"
                [class.primary]="filter() === f.id"
                [attr.aria-pressed]="filter() === f.id"
                (click)="filter.set(f.id)"
              >
                {{ f.label }}
              </button>
            }
          </div>
        </div>
        @if (lessons.isLoading()) {
          <p class="empty">Loading…</p>
        } @else if (lessons.error()) {
          <p class="empty">Could not load lessons.</p>
        } @else {
          <div class="table-wrap scroll">
            <table class="data" style="min-width: 860px">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Student</th>
                  <th>Teacher</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th style="text-align: right">Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (l of visible(); track l.id) {
                  <tr>
                    <td class="num">
                      <a [routerLink]="['/admin/lessons', l.id]"
                        ><strong>{{ cairo(l.startsAt) }}</strong></a
                      >
                      <span class="sub">{{ local(l) }}</span>
                    </td>
                    <td>
                      <a [routerLink]="['/admin/students', l.student.id]"
                        ><strong>{{ l.student.name }}</strong></a
                      >
                      <span class="sub">{{ tier(l.plan) }}</span>
                    </td>
                    <td>{{ l.teacher.name }}</td>
                    <td>
                      <span class="chip outline">{{ type(l) }}</span>
                    </td>
                    <td><app-lesson-status [lesson]="l" /></td>
                    <td class="num muted">{{ joined(l) }}</td>
                    <td style="text-align: right; white-space: nowrap">
                      <button type="button" class="btn small" (click)="openRoom(l)">
                        Join link
                      </button>
                      @if (l.status === 'SCHEDULED') {
                        <button type="button" class="btn small" (click)="editing.set(l)">
                          Change
                        </button>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="7" class="empty">No lessons here.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>

      <app-attendance-check (changed)="refresh()" />

      @if (makeups.value().length) {
        <section class="card flush" aria-labelledby="makeups-title" id="makeups">
          <div class="card-head">
            <h2 id="makeups-title">Makeups to book</h2>
            <span class="muted small">the teacher missed these; the student gets a new lesson</span>
          </div>
          <ul class="owed">
            @for (l of makeups.value(); track l.id) {
              <li>
                <span
                  ><strong>{{ l.student.name }}</strong> · {{ owedWhen(l) }} with
                  {{ l.teacher.name }}</span
                >
                @if (l.subscriptionId) {
                  <a
                    class="btn small"
                    [routerLink]="['/admin/students', l.student.id, 'add-lesson']"
                    [queryParams]="{ makeup: l.id }"
                    [attr.aria-label]="'Book makeup for ' + l.student.name + ', ' + owedWhen(l)"
                    >Book makeup</a
                  >
                }
              </li>
            }
          </ul>
        </section>
      }

      @if (stats.value(); as st) {
        <section class="glance" aria-labelledby="glance-title">
          <h2 id="glance-title">The academy</h2>
          <div class="tiles">
            <a class="tile" routerLink="/admin/students"
              ><span>Active students</span><strong>{{ st.activeStudents }}</strong
              ><small>{{ st.activeTeachers }} teachers</small></a
            >
            <a class="tile" routerLink="/admin/invoices"
              ><span>Unpaid invoices</span><strong>{{ unpaidCount(st) }}</strong
              ><small>{{ unpaidText(st) }}</small></a
            >
            <a class="tile" [class.alert]="st.overdueInvoices > 0" routerLink="/admin/invoices"
              ><span>Cycle started, not paid</span><strong>{{ st.overdueInvoices }}</strong
              ><small>prepaid invoices to chase</small></a
            >
            <a class="tile" [class.alert]="st.openRequests > 0" routerLink="/admin/requests"
              ><span>Open requests</span><strong>{{ st.openRequests }}</strong
              ><small>waiting for an answer</small></a
            >
            <div class="tile">
              <span>Lessons, next 7 days</span><strong>{{ st.lessonsNext7Days }}</strong
              ><small
                >last 7 days: {{ st.cancelledLast7Days }} cancelled,
                {{ plural(st.missingNotesLast7Days, 'held lesson') }} without notes</small
              >
            </div>
            <a
              class="tile"
              [class.alert]="st.attendanceToCheck + st.makeupsOwed > 0"
              routerLink="/admin/today"
              [fragment]="st.attendanceToCheck ? 'attendance' : 'makeups'"
              ><span>Attendance to check</span><strong>{{ st.attendanceToCheck }}</strong
              ><small>{{
                st.makeupsOwed
                  ? plural(st.makeupsOwed, 'makeup') + ' to book'
                  : 'someone did not enter class'
              }}</small></a
            >
          </div>
        </section>
      }
      <app-page-log title="Latest activity" />
    </div>
    <app-lesson-action-dialog [lesson]="editing()" (closed)="onClosed($event)" />
  `,
  styles: `
    .scroll {
      max-height: min(560px, 65vh);
      overflow-y: auto;
    }
    .scroll thead th {
      position: sticky;
      top: 0;
      z-index: 1;
    }
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .glance {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .glance h2 {
      margin: 0;
      font-size: 15px;
    }
    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
      gap: 10px;
    }
    .tile {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 14px 16px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      color: inherit;
      text-decoration: none;
    }
    a.tile:hover {
      border-color: var(--primary);
    }
    .tile span {
      font-size: 13px;
      color: var(--muted);
    }
    .tile strong {
      font-size: 26px;
      letter-spacing: -0.01em;
    }
    .tile small {
      font-size: 12px;
      color: var(--muted);
    }
    .tile.alert strong {
      color: var(--warn);
    }
    .owed {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .owed li {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      align-items: center;
      justify-content: space-between;
      padding: 12px 18px;
      border-top: 1px solid var(--border);
    }
  `,
})
export class AdminToday {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly lessons = httpResource<Lesson[]>(() => '/api/lessons/today', {
    defaultValue: [],
  });
  protected readonly openRequests = httpResource<{ open: number }>(() => '/api/requests/summary');
  protected readonly stats = httpResource<AcademyStats>(() => '/api/stats/overview');
  /** The six-week schedule check lives on its own page; here only how many need attention. */
  private readonly schedule = httpResource<{ problems: unknown[] }>(
    () => '/api/lessons/schedule-check',
  );
  protected readonly scheduleProblems = computed(() => this.schedule.value()?.problems.length ?? 0);
  protected readonly makeups = httpResource<Lesson[]>(() => '/api/lessons/makeups-owed', {
    defaultValue: [],
  });

  protected refresh() {
    this.stats.reload();
    this.makeups.reload();
    this.lessons.reload();
  }
  protected plural(n: number, word: string) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
  }
  protected owedWhen(l: Lesson) {
    return `${day(l.startsAt, ACADEMY_TZ)} ${time(l.startsAt, ACADEMY_TZ)} Cairo`;
  }

  protected unpaidCount(st: AcademyStats) {
    return st.unpaid.reduce((n, u) => n + u.invoices, 0);
  }
  protected unpaidText(st: AcademyStats) {
    return st.unpaid.length
      ? st.unpaid.map((u) => money(u.totalCents, u.currency)).join(' + ')
      : 'all paid';
  }
  protected readonly filter = signal<Filter>('all');
  protected readonly editing = signal<Lesson | null>(null);
  protected readonly message = signal('');
  protected readonly today = day(new Date(), ACADEMY_TZ);
  protected readonly filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'done', label: 'Done' },
    { id: 'cancelled', label: 'Cancelled' },
  ];

  protected readonly counts = computed(() => {
    const list = this.lessons.value();
    const now = Date.now();
    const live = list.filter((l) => {
      const s = new Date(l.startsAt).getTime();
      return l.status === 'SCHEDULED' && now >= s && now <= s + l.durationMin * 60_000;
    }).length;
    return {
      all: list.filter((l) => l.status !== 'RESCHEDULED').length,
      live,
      done: list.filter((l) => l.status === 'COMPLETED').length,
      cancelled: list.filter((l) => l.status === 'CANCELLED').length,
    };
  });

  protected readonly visible = computed(() => {
    const list = this.lessons.value().filter((l) => l.status !== 'RESCHEDULED');
    switch (this.filter()) {
      case 'upcoming':
        return list.filter((l) => l.status === 'SCHEDULED');
      case 'done':
        return list.filter((l) => l.status === 'COMPLETED');
      case 'cancelled':
        return list.filter((l) => l.status === 'CANCELLED');
      default:
        return list;
    }
  });

  protected cairo(iso: string) {
    return time(iso, ACADEMY_TZ);
  }
  protected local(l: Lesson) {
    return `${time(l.startsAt, l.student.timezone)} ${city(l.student.timezone)}`;
  }
  protected tier = tierLabel;
  protected type(l: Lesson) {
    return typeLabel(l.type, l.extraReason);
  }
  protected joined(l: Lesson) {
    if (!l.teacherJoinedAt && !l.studentJoinedAt) return '—';
    const t = l.teacherJoinedAt ? time(l.teacherJoinedAt, ACADEMY_TZ) : '—';
    const s = l.studentJoinedAt ? time(l.studentJoinedAt, ACADEMY_TZ) : '—';
    return `T ${t} · S ${s}`;
  }

  protected async openRoom(l: Lesson) {
    try {
      const { zoomLink } = await this.api.enterClass(l.id);
      if (zoomLink) window.open(zoomLink, '_blank', 'noopener');
      else this.toast.error('No meeting link set for this teacher.');
    } catch (err) {
      this.message.set(errorMessage(err));
    }
  }

  protected onClosed(changed: boolean) {
    this.editing.set(null);
    if (changed) {
      this.lessons.reload();
      this.schedule.reload();
    }
  }
}
