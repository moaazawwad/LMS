import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/api.service';
import { ACADEMY_TZ, addDays, time, zonedTimeToUtc } from '../../core/format';
import { RouterLink } from '@angular/router';
import type { AuditEntry } from '../../core/models';
import { DateField } from '../../shared/date-field';

const PAGE = 100;

/** Short names for the log's actions. */
const ACTIONS: Record<string, string> = {
  'lesson.cancel': 'Lesson cancelled',
  'lesson.reschedule': 'Lesson moved',
  'lesson.transfer': 'Lesson moved to another teacher',
  'lesson.enter': 'Entered class',
  'lesson.attendance': 'Attendance settled',
  'lesson.review': 'Attendance checked',
  'lesson.extra': 'Extra lesson added',
  'lesson.notes': 'Lesson notes',
  'homework.send': 'Homework answer',
  'homework.check': 'Homework checked',
  'homework.file': 'Homework file',
  'invoice.pay': 'Invoice paid',
  'invoice.void': 'Invoice voided',
  'invoice.reissue': 'Invoice re-issued',
  'teacher.payout': 'Teacher paid',
  'teacher.payout-undo': 'Teacher payment undone',
  'student.import': 'Students imported',
  'teacher.import': 'Teachers imported',
  'student.create': 'Student added',
  'student.update': 'Student changed',
  'teacher.create': 'Teacher added',
  'teacher.update': 'Teacher changed',
  'teacher.availability': 'Teacher hours changed',
  'staff.create': 'Staff added',
  'staff.update': 'Staff changed',
  'cycle.create': 'New cycle',
  'request.create': 'Request sent',
  'request.approve': 'Request approved',
  'request.decline': 'Request declined',
  'request.withdraw': 'Request withdrawn',
  'subscription.create': 'Subscription started',
  'subscription.update': 'Subscription changed',
  'subscription.transfer': 'Moved to another teacher',
  'subscription.pause': 'Subscription paused',
  'curriculum.create': 'Curriculum added',
  'curriculum.update': 'Curriculum changed',
  'plan.create': 'Plan added',
  'plan.update': 'Plan changed',
  'pay.level-rates': 'Pay by level changed',
  'settings.payment': 'Payment instructions changed',
  'user.password-reset': 'Password reset',
  'user.password': 'Password changed',
  'user.profile': 'Profile changed',
  'auth.locked': 'Sign-in paused',
};

/** Friendlier names for changed fields. */
const FIELDS: Record<string, string> = {
  fullName: 'Name',
  phone: 'Phone',
  email: 'Email',
  timezone: 'Time zone',
  status: 'Status',
  level: 'Level',
  zoomLink: 'Meeting link',
  bio: 'Notes',
  isActive: 'Sign-in on',
  role: 'Role',
  priceCents: 'Price (cents)',
  hoursPerCycle: 'Hours a cycle',
  lessonMinutes: 'Lesson minutes',
  lessonsPerWeek: 'Lessons a week',
  cancelQuota: 'Cancel quota',
  rescheduleQuota: 'Reschedule quota',
  name: 'Name',
  areas: 'Areas',
};

@Component({
  selector: 'app-admin-logs',
  imports: [DateField, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <h1>Activity log</h1>
          <p>Every change by every role. Entries can't be edited or deleted. Times in Cairo.</p>
        </div>
        <div class="filters">
          <div class="field grow">
            <label for="find">Search</label>
            <input
              id="find"
              type="search"
              placeholder="Name, lesson, invoice…"
              [value]="text()"
              (input)="typed($any($event.target).value)"
            />
          </div>
          <div class="field">
            <label for="day">Day (Cairo)</label>
            <app-date-field
              inputId="day"
              [clearable]="true"
              placeholder="Any day"
              [(value)]="day"
            />
          </div>
          <div class="field">
            <label for="who">Done by</label>
            <select
              id="who"
              [value]="actorKind()"
              (change)="actorKind.set($any($event.target).value)"
            >
              <option value="">Everyone</option>
              <option value="ADMIN">Admin &amp; staff</option>
              <option value="TEACHER">Teachers</option>
              <option value="STUDENT">Students</option>
              <option value="SYSTEM">System</option>
            </select>
          </div>
          <div class="field">
            <label for="what">Action</label>
            <select id="what" [value]="action()" (change)="action.set($any($event.target).value)">
              <option value="">All actions</option>
              <option value="lesson.cancel">Cancellations</option>
              <option value="lesson.reschedule">Reschedules</option>
              <option value="lesson.transfer">Transfers</option>
              <option value="lesson.enter">Enter class</option>
              <option value="lesson.attendance">Attendance settled</option>
              <option value="lesson.review">Attendance checked</option>
              <option value="lesson.extra">Extra and makeup lessons</option>
              <option value="invoice.pay">Payments</option>
              <option value="invoice.void">Voided invoices</option>
              <option value="invoice.reissue">New invoices for voided ones</option>
              <option value="teacher.payout">Teacher pay recorded</option>
              <option value="student.import">Students imported</option>
              <option value="teacher.import">Teachers imported</option>
              <option value="cycle.create">New cycles</option>
              <option value="request.create">Requests sent</option>
              <option value="request.approve">Requests approved</option>
              <option value="request.decline">Requests declined</option>
              <option value="subscription.create">New subscriptions</option>
              <option value="subscription.update">Subscription changes</option>
              <option value="lesson.notes">Lesson notes</option>
              <option value="user.password-reset">Password resets</option>
              <option value="auth.locked">Sign-in paused</option>
            </select>
          </div>
        </div>
      </header>
      <section class="card flush">
        <div class="table-wrap">
          <table class="data log" style="min-width: 900px">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>About</th>
                <th>What happened</th>
              </tr>
            </thead>
            <tbody>
              @for (e of logs(); track e.id) {
                <tr [class.override]="e.override">
                  <td class="when">
                    <span>{{ day1(e.at) }}</span>
                    <span class="muted">{{ clock(e.at) }}</span>
                  </td>
                  <td class="who">
                    <strong>{{ e.actorName ?? 'System' }}</strong>
                    <span class="muted">{{ role(e.actorKind) }}</span>
                  </td>
                  <td class="about">
                    @if (e.about?.student; as st) {
                      <span
                        ><span class="tag">Student</span>
                        <a [routerLink]="['/admin/students', st.id]">{{ st.name }}</a></span
                      >
                    }
                    @if (e.about?.teacher; as te) {
                      <span
                        ><span class="tag">Teacher</span>
                        <a [routerLink]="['/admin/teachers', te.id]">{{ te.name }}</a></span
                      >
                    }
                    @if (e.about?.user; as u) {
                      <span
                        ><span class="tag">{{ u.role.toLowerCase() }}</span> {{ u.name }}</span
                      >
                    }
                    @if (!e.about) {
                      <span class="muted">—</span>
                    }
                  </td>
                  <td class="what">
                    <span class="act"
                      >{{ actionLabel(e.action) }}
                      @if (e.override) {
                        <span class="chip warn">override</span>
                      }
                    </span>
                    <span>{{ e.summary }}</span>
                    @if (e.changes.length) {
                      <ul class="changes">
                        @for (c of e.changes; track c.field) {
                          <li>
                            <span class="muted">{{ fieldLabel(c.field) }}:</span>
                            {{ pretty(c.from) }} <span aria-label="changed to">→</span>
                            <strong>{{ pretty(c.to) }}</strong>
                          </li>
                        }
                      </ul>
                    }
                    @if (e.note) {
                      <span class="sub">Note: {{ e.note }}</span>
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="4" class="empty">
                    {{ loading() ? 'Loading…' : 'Nothing matches.' }}
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
      @if (hasMore() && !loading()) {
        <div><button type="button" class="btn" (click)="older()">Show older entries</button></div>
      }
    </div>
  `,
  styles: `
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    .filters .field {
      min-width: 160px;
    }
    .filters .grow {
      min-width: 220px;
    }
    tr.override td {
      background: #fff8ec;
    }
    .log td {
      vertical-align: top;
    }
    .when span,
    .who > *,
    .about > span,
    .what > span {
      display: block;
    }
    .when {
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .who {
      white-space: nowrap;
    }
    .who .muted,
    .when .muted {
      font-size: 12px;
    }
    .about > span {
      display: grid;
      grid-template-columns: 64px auto;
      align-items: baseline;
      white-space: nowrap;
    }
    .about > span + span {
      margin-top: 4px;
    }
    .tag {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
    }
    .act {
      font-weight: 700;
      margin-bottom: 2px;
    }
    .act .chip {
      margin-left: 6px;
    }
    .changes {
      margin: 6px 0 0;
      padding: 0;
      list-style: none;
      font-size: 13px;
      display: grid;
      gap: 2px;
    }
    .changes strong {
      margin-left: 4px;
    }
    .sub {
      font-size: 13px;
      color: var(--muted);
      margin-top: 4px;
    }
  `,
})
export class AdminLogs {
  private readonly http = inject(HttpClient);
  protected readonly actorKind = signal('');
  protected readonly action = signal('');
  protected readonly day = signal('');
  /** what is typed; `search` follows it after a short pause */
  protected readonly text = signal('');
  private readonly search = signal('');
  private timer: ReturnType<typeof setTimeout> | undefined;

  protected readonly logs = signal<AuditEntry[]>([]);
  protected readonly loading = signal(false);
  protected readonly hasMore = signal(false);
  protected readonly error = signal('');
  /** bumps on every new search, so a slow older answer can't overwrite a newer one */
  private generation = 0;

  constructor() {
    // Any filter change starts the list again from the newest entry.
    effect(() => {
      this.actorKind();
      this.action();
      this.day();
      this.search();
      untracked(() => void this.load(true));
    });
  }

  protected typed(value: string) {
    this.text.set(value);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.search.set(value.trim()), 300);
  }

  protected older() {
    void this.load(false);
  }

  private async load(fresh: boolean) {
    const generation = fresh ? ++this.generation : this.generation;
    const params: Record<string, string> = { limit: String(PAGE) };
    if (this.actorKind()) params['actorKind'] = this.actorKind();
    if (this.action()) params['action'] = this.action();
    if (this.search()) params['q'] = this.search();
    if (this.day()) {
      params['from'] = zonedTimeToUtc(this.day(), '00:00', ACADEMY_TZ).toISOString();
      params['to'] = zonedTimeToUtc(addDays(this.day(), 1), '00:00', ACADEMY_TZ).toISOString();
    }
    const oldest = this.logs().at(-1);
    if (!fresh && oldest) params['to'] = oldest.at;
    this.loading.set(true);
    this.error.set('');
    try {
      const page = await firstValueFrom(this.http.get<AuditEntry[]>('/api/audit-logs', { params }));
      if (generation !== this.generation) return;
      this.logs.update((list) => (fresh ? page : [...list, ...page]));
      this.hasMore.set(page.length === PAGE);
    } catch (err) {
      if (generation === this.generation) this.error.set(errorMessage(err));
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
  }
  protected day1(iso: string) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: ACADEMY_TZ,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(iso));
  }
  protected clock(iso: string) {
    return time(iso, ACADEMY_TZ);
  }
  protected role(kind: AuditEntry['actorKind']) {
    return { ADMIN: 'Admin / staff', TEACHER: 'Teacher', STUDENT: 'Student', SYSTEM: 'Automatic' }[
      kind
    ];
  }
  protected actionLabel(action: string) {
    return ACTIONS[action] ?? action.replace(/[.-]/g, ' ').replace(/^./, (c) => c.toUpperCase());
  }
  /** "SCHEDULED" → "Scheduled", "TEACHER_ONLY" → "Teacher only"; other values as they are. */
  protected pretty(value: string) {
    return /^[A-Z][A-Z_]+$/.test(value)
      ? value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ')
      : value;
  }
  protected fieldLabel(field: string) {
    return (
      FIELDS[field] ??
      field
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (c) => c.toUpperCase())
        .trim()
    );
  }
}
