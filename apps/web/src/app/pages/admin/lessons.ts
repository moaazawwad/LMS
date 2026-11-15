import { HttpClient, httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/api.service';
import {
  ACADEMY_TZ,
  addDays,
  dayTime,
  localDate,
  time,
  typeLabel,
  zonedTimeToUtc,
} from '../../core/format';
import type { Lesson, StudentRow, TeacherRow } from '../../core/models';
import { DateField } from '../../shared/date-field';
import { LessonActionDialog } from '../../shared/lesson-action-dialog';
import { LessonStatus } from '../../shared/lesson-status';
import { PageLog } from '../../shared/page-log';

type Kind = 'all' | 'regular' | 'trial' | 'extra' | 'cancelled' | 'rescheduled';
const PAGE = 50;

/** Every lesson, by kind, with filters; each opens its own page. */
@Component({
  selector: 'app-admin-lessons',
  imports: [PageLog, RouterLink, DateField, LessonStatus, LessonActionDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <h1>Lessons</h1>
          <p>Times in Cairo, with the student's own time under each.</p>
        </div>
      </header>

      <div class="tabs" role="tablist" aria-label="Kind of lesson">
        @for (k of kinds; track k.id) {
          <button
            type="button"
            role="tab"
            [attr.aria-selected]="kind() === k.id"
            [class.on]="kind() === k.id"
            (click)="kind.set(k.id)"
          >
            {{ k.label }}
          </button>
        }
      </div>

      <div class="filters">
        <div class="field">
          <label for="l-from">From</label>
          <app-date-field inputId="l-from" [max]="to()" [(value)]="from" />
        </div>
        <div class="field">
          <label for="l-to">To</label>
          <app-date-field inputId="l-to" [min]="from()" [(value)]="to" />
        </div>
        <div class="field">
          <label for="l-teacher">Teacher</label>
          <select
            id="l-teacher"
            [value]="teacherId()"
            (change)="teacherId.set($any($event.target).value)"
          >
            <option value="">All teachers</option>
            @for (t of teachers.value(); track t.id) {
              <option [value]="t.id">{{ t.fullName }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label for="l-student">Student</label>
          <select
            id="l-student"
            [value]="studentId()"
            (change)="studentId.set($any($event.target).value)"
          >
            <option value="">All students</option>
            @for (s of students.value(); track s.id) {
              <option [value]="s.id">{{ s.fullName }}</option>
            }
          </select>
        </div>
      </div>

      <section class="card flush">
        <div class="table-wrap">
          <table class="data" style="min-width: 1040px" aria-label="Lessons">
            <thead>
              <tr>
                <th>When (Cairo)</th>
                <th>Student</th>
                <th>Teacher</th>
                <th>Curriculum</th>
                <th>Type</th>
                <th>Status</th>
                <th class="r"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              @for (l of rows(); track l.id) {
                <tr>
                  <td class="num">
                    <a [routerLink]="[l.id]"
                      ><strong>{{ cairo(l.startsAt) }}</strong></a
                    >
                    <span class="sub">{{ local(l) }} · {{ l.durationMin }} min</span>
                  </td>
                  <td>
                    <a [routerLink]="['/admin/students', l.student.id]">{{ l.student.name }}</a>
                  </td>
                  <td>
                    <a [routerLink]="['/admin/teachers', l.teacher.id]">{{ l.teacher.name }}</a>
                  </td>
                  <td>{{ l.curriculum }}</td>
                  <td>
                    <span class="chip outline">{{ type(l) }}</span>
                  </td>
                  <td>
                    <app-lesson-status [lesson]="l" />
                    @if (l.movedTo; as m) {
                      <span class="sub"
                        >moved to <a [routerLink]="[m.id]">{{ cairo(m.startsAt) }}</a> ·
                        {{ m.teacher }}</span
                      >
                    }
                  </td>
                  <td class="r" style="white-space: nowrap">
                    <a
                      class="btn small"
                      [routerLink]="[l.id]"
                      [attr.aria-label]="'Open lesson ' + cairo(l.startsAt)"
                      >Open</a
                    >
                    @if (l.status === 'SCHEDULED') {
                      <button type="button" class="btn small" (click)="editing.set(l)">
                        Change
                      </button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="7" class="empty">
                    {{ loading() ? 'Loading…' : 'No lessons match.' }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
      @if (error()) {
        <p class="notice danger" role="alert">{{ error() }}</p>
      }
      @if (more() && !loading()) {
        <div><button type="button" class="btn" (click)="load(false)">Show more</button></div>
      }
      <app-page-log title="Activity on lessons" actions="lesson.,homework.,cancel,reschedule" />
    </div>
    <app-lesson-action-dialog [lesson]="editing()" (closed)="closed($event)" />
  `,
  styles: `
    .tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      border-bottom: 1px solid var(--border);
    }
    .tabs button {
      border: 0;
      background: none;
      font: inherit;
      font-size: 14px;
      font-weight: 600;
      color: var(--muted);
      padding: 10px 14px;
      border-bottom: 3px solid transparent;
      cursor: pointer;
      margin-bottom: -1px;
    }
    .tabs button.on {
      color: var(--primary);
      border-bottom-color: var(--primary);
    }
    .filters {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }
    .sub {
      display: block;
      font-size: 12px;
      color: var(--muted);
    }
    .r {
      text-align: right;
    }
    td {
      white-space: nowrap;
    }
  `,
})
export class AdminLessons {
  private readonly http = inject(HttpClient);
  protected readonly kinds: { id: Kind; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'regular', label: 'Regular' },
    { id: 'trial', label: 'Trial' },
    { id: 'extra', label: 'Extra & makeup' },
    { id: 'cancelled', label: 'Cancelled' },
    { id: 'rescheduled', label: 'Rescheduled' },
  ];
  private readonly today = localDate(new Date(), ACADEMY_TZ);
  protected readonly kind = signal<Kind>('all');
  protected readonly from = signal(addDays(this.today, -30));
  protected readonly to = signal(addDays(this.today, 30));
  protected readonly teacherId = signal('');
  protected readonly studentId = signal('');
  protected readonly rows = signal<Lesson[]>([]);
  protected readonly loading = signal(false);
  protected readonly more = signal(false);
  protected readonly error = signal('');
  protected readonly editing = signal<Lesson | null>(null);
  protected readonly teachers = httpResource<TeacherRow[]>(() => '/api/teachers', {
    defaultValue: [],
  });
  protected readonly students = httpResource<StudentRow[]>(() => '/api/students', {
    defaultValue: [],
  });
  private generation = 0;

  private readonly filters = computed(() => ({
    kind: this.kind(),
    from: this.from(),
    to: this.to(),
    teacherId: this.teacherId(),
    studentId: this.studentId(),
  }));

  constructor() {
    effect(() => {
      this.filters();
      untracked(() => void this.load(true));
    });
  }

  async load(fresh: boolean) {
    const f = this.filters();
    const generation = fresh ? ++this.generation : this.generation;
    const params: Record<string, string> = {
      limit: String(PAGE),
      offset: String(fresh ? 0 : this.rows().length),
    };
    if (f.kind !== 'all') params['kind'] = f.kind;
    // "All" leaves out the old copies of moved lessons (they are under Rescheduled).
    if (f.from) params['from'] = zonedTimeToUtc(f.from, '00:00', ACADEMY_TZ).toISOString();
    if (f.to) params['to'] = zonedTimeToUtc(addDays(f.to, 1), '00:00', ACADEMY_TZ).toISOString();
    if (f.teacherId) params['teacherId'] = f.teacherId;
    if (f.studentId) params['studentId'] = f.studentId;
    this.loading.set(true);
    this.error.set('');
    try {
      const page = await firstValueFrom(this.http.get<Lesson[]>('/api/lessons', { params }));
      if (generation !== this.generation) return;
      const shown = f.kind === 'all' ? page.filter((l) => l.status !== 'RESCHEDULED') : page;
      this.rows.update((list) => (fresh ? shown : [...list, ...shown]));
      this.more.set(page.length === PAGE);
    } catch (err) {
      if (generation === this.generation) this.error.set(errorMessage(err));
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
  }

  protected cairo(iso: string) {
    return dayTime(iso, ACADEMY_TZ);
  }
  protected local(l: Lesson) {
    return `${time(l.startsAt, l.student.timezone)} ${l.student.timezone.split('/').pop()?.replace(/_/g, ' ')}`;
  }
  protected type(l: Lesson) {
    return typeLabel(l.type, l.extraReason);
  }
  protected closed(changed: boolean) {
    this.editing.set(null);
    if (changed) void this.load(true);
  }
}
