import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ACADEMY_TZ, dayTime, tierLabel, time, typeLabel } from '../../core/format';
import type { AuditEntry, Lesson, LessonHistory } from '../../core/models';
import { LessonActionDialog, type LessonTab } from '../../shared/lesson-action-dialog';
import { LessonStatus } from '../../shared/lesson-status';

const ATTENDANCE: Record<string, string> = {
  BOTH: 'Both entered',
  TEACHER_ONLY: 'The teacher entered, the student did not',
  STUDENT_ONLY: 'The student entered, the teacher did not',
  NONE: 'Nobody entered',
};

/** One lesson with everything about it: people, times, who entered when, history, money and log. */
@Component({
  selector: 'app-admin-lesson',
  imports: [RouterLink, LessonStatus, LessonActionDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      @if (lesson.value(); as l) {
        <nav aria-label="Breadcrumb" class="muted">
          <a routerLink="/admin/lessons">Lessons</a> / {{ cairo(l.startsAt) }}
        </nav>
        <header class="page-head">
          <div>
            <h1>{{ type(l) }} lesson · {{ cairo(l.startsAt) }} Cairo</h1>
            <p>
              <app-lesson-status [lesson]="l" /> · {{ l.durationMin }} min · {{ l.curriculum }} ·
              {{ local(l) }} for the student
            </p>
          </div>
          @if (l.status === 'SCHEDULED') {
            <div class="head-actions">
              <button type="button" class="btn" (click)="open(l, 'reschedule')">Reschedule</button>
              <button type="button" class="btn danger" (click)="open(l, 'cancel')">Cancel</button>
              @if (l.subscriptionId) {
                <a
                  class="btn"
                  [routerLink]="['/admin/students', l.student.id, 'transfer']"
                  [queryParams]="{ subscription: l.subscriptionId, lesson: l.id }"
                  >Transfer</a
                >
              }
            </div>
          }
        </header>

        <div class="cols">
          <div class="main">
            <section class="card" aria-labelledby="who-title">
              <h2 id="who-title">People and link</h2>
              <dl>
                <dt>Student</dt>
                <dd>
                  <a [routerLink]="['/admin/students', l.student.id]">{{ l.student.name }}</a> ·
                  {{ l.student.timezone }}
                </dd>
                <dt>Teacher</dt>
                <dd>
                  <a [routerLink]="['/admin/teachers', l.teacher.id]">{{ l.teacher.name }}</a>
                </dd>
                <dt>Meeting link</dt>
                <dd>
                  @if (history.value()?.meetingLink; as link) {
                    <a [href]="link" target="_blank" rel="noopener">{{ link }}</a>
                    <button type="button" class="btn small" (click)="copy(link)">
                      {{ copied() ? 'Copied' : 'Copy' }}
                    </button>
                  } @else {
                    <span class="muted">Not set</span>
                  }
                </dd>
                @if (l.subscriptionId) {
                  <dt>Subscription</dt>
                  <dd>
                    <a [routerLink]="['/admin/subscriptions', l.subscriptionId]">{{
                      l.plan ? tier(l.plan) + ' plan' : 'Open'
                    }}</a>
                  </dd>
                }
              </dl>
            </section>

            <section class="card" aria-labelledby="att-title">
              <h2 id="att-title">Attendance</h2>
              <dl>
                <dt>Teacher entered</dt>
                <dd>{{ l.teacherJoinedAt ? cairoTime(l.teacherJoinedAt) + ' Cairo' : '—' }}</dd>
                <dt>Student entered</dt>
                <dd>{{ l.studentJoinedAt ? cairoTime(l.studentJoinedAt) + ' Cairo' : '—' }}</dd>
                <dt>Result</dt>
                <dd>
                  {{
                    l.attendance
                      ? attendance[l.attendance]
                      : l.status === 'SCHEDULED'
                        ? 'Not yet'
                        : '—'
                  }}
                </dd>
                @if (l.teacherPaid !== undefined && l.teacherPaid !== null) {
                  <dt>Teacher paid</dt>
                  <dd>{{ l.teacherPaid ? 'Yes' : 'No' }}</dd>
                }
                @if (history.value(); as h) {
                  @if (h.reviewedAt) {
                    <dt>Checked by</dt>
                    <dd>{{ h.reviewedBy ?? 'Staff' }} · {{ cairo(h.reviewedAt) }}</dd>
                  }
                }
              </dl>
            </section>

            <section class="card" aria-labelledby="work-title">
              <h2 id="work-title">Notes and homework</h2>
              <dl>
                <dt>Teacher's notes</dt>
                <dd class="pre">{{ l.notes || '—' }}</dd>
                <dt>Homework</dt>
                <dd class="pre">
                  @if (l.homeworkTitle) {
                    <strong>{{ l.homeworkTitle }}</strong>
                    {{ l.homeworkBody }}
                  } @else {
                    —
                  }
                </dd>
                @if (l.homeworkAnswer) {
                  <dt>Student's answer</dt>
                  <dd class="pre">{{ l.homeworkAnswer }}</dd>
                }
                @if (l.homeworkFeedback) {
                  <dt>Teacher's reply</dt>
                  <dd class="pre">{{ l.homeworkFeedback }}</dd>
                }
              </dl>
            </section>
          </div>

          <div class="side">
            <section class="card" aria-labelledby="hist-title">
              <h2 id="hist-title">History</h2>
              @if (history.value(); as h) {
                <ul class="timeline">
                  <li><span class="muted">Booked</span> {{ cairo(h.createdAt) }}</li>
                  @if (h.movedFrom; as m) {
                    <li>
                      <span class="muted">Moved here from</span>
                      <a [routerLink]="['/admin/lessons', m.id]">{{ cairo(m.startsAt) }}</a> ·
                      {{ m.teacher }}
                    </li>
                  }
                  @for (m of h.movedTo; track m.id) {
                    <li>
                      <span class="muted">Moved to</span>
                      <a [routerLink]="['/admin/lessons', m.id]">{{ cairo(m.startsAt) }}</a> ·
                      {{ m.teacher }}
                    </li>
                  }
                  @if (h.cancelledAt) {
                    <li>
                      <span class="muted">Cancelled</span> {{ cairo(h.cancelledAt) }}
                      {{ h.cancelledBy ? 'by ' + h.cancelledBy.toLowerCase() : '' }}
                      @if (l.cancelReason && !h.cancelledBy) {
                        · {{ reason(l.cancelReason) }}
                      }
                      @if (l.countedAsTaken) {
                        · counted as taken
                      }
                      @if (l.makeupOwed) {
                        · makeup owed
                      }
                    </li>
                  }
                  @if (h.closedAt) {
                    <li><span class="muted">Closed</span> {{ cairo(h.closedAt) }}</li>
                  }
                </ul>
              } @else {
                <p class="muted">Loading…</p>
              }
            </section>

            <section class="card" aria-labelledby="money-title">
              <h2 id="money-title">Billing</h2>
              @if (history.value(); as h) {
                <dl>
                  @if (l.type === 'TRIAL') {
                    <dt>Price</dt>
                    <dd>Free trial: no invoice</dd>
                  }
                  @if (h.invoice; as inv) {
                    <dt>Invoice</dt>
                    <dd>
                      <a [routerLink]="['/admin/invoices', inv.id]">{{ inv.number }}</a> ·
                      {{ inv.status.toLowerCase() }}
                    </dd>
                  }
                  @if (h.credit; as c) {
                    <dt>Credit</dt>
                    <dd>
                      {{ c.status.toLowerCase() }}
                      @if (c.invoiceId) {
                        on <a [routerLink]="['/admin/invoices', c.invoiceId]">{{ c.invoice }}</a>
                      }
                    </dd>
                  }
                  @if (h.charge; as c) {
                    <dt>Charged as extra</dt>
                    <dd>
                      {{ c.status.toLowerCase() }}
                      @if (c.invoiceId) {
                        on <a [routerLink]="['/admin/invoices', c.invoiceId]">{{ c.invoice }}</a>
                      }
                    </dd>
                  }
                  @if (!h.invoice && !h.credit && !h.charge && l.type !== 'TRIAL') {
                    <dt>Invoice</dt>
                    <dd>—</dd>
                  }
                </dl>
              }
            </section>

            <section class="card" aria-labelledby="log-title">
              <h2 id="log-title">Activity</h2>
              <ul class="timeline">
                @for (e of log.value(); track e.id) {
                  <li>
                    <span class="muted">{{ cairo(e.at) }} · {{ e.actorName ?? 'System' }}</span>
                    {{ e.summary }}
                    @if (e.note) {
                      <span class="muted">Note: {{ e.note }}</span>
                    }
                  </li>
                } @empty {
                  <li class="muted">Nothing logged yet.</li>
                }
              </ul>
            </section>
          </div>
        </div>
        <app-lesson-action-dialog
          [lesson]="editing()"
          [startTab]="tab()"
          (closed)="closed($event)"
        />
      } @else {
        <p class="empty">{{ lesson.error() ? 'Lesson not found.' : 'Loading…' }}</p>
      }
    </div>
  `,
  styles: `
    .cols {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
      gap: 16px;
      align-items: start;
    }
    .main,
    .side {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    h2 {
      margin: 0 0 10px;
      font-size: 16px;
    }
    dl {
      margin: 0;
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 8px 14px;
      font-size: 14px;
    }
    dt {
      color: var(--muted);
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
      display: flex;
      flex-wrap: wrap;
      gap: 4px 8px;
      align-items: center;
    }
    dd.pre {
      white-space: pre-line;
      display: block;
    }
    .timeline {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 10px;
      font-size: 14px;
    }
    .timeline li {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding-left: 12px;
      border-left: 3px solid var(--border);
    }
    .timeline .muted {
      font-size: 12px;
    }
    .head-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    @media (max-width: 900px) {
      .cols {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class AdminLesson {
  readonly id = input.required<string>();
  protected readonly lesson = httpResource<Lesson>(() => `/api/lessons/${this.id()}`);
  protected readonly history = httpResource<LessonHistory>(
    () => `/api/lessons/${this.id()}/history`,
  );
  protected readonly log = httpResource<AuditEntry[]>(
    () => ({ url: '/api/audit-logs', params: { entityId: this.id(), limit: 50 } }),
    { defaultValue: [] },
  );
  protected readonly attendance = ATTENDANCE;
  protected readonly editing = signal<Lesson | null>(null);
  protected readonly tab = signal<LessonTab>('reschedule');
  protected readonly copied = signal(false);
  protected readonly isTrial = computed(() => this.lesson.value()?.type === 'TRIAL');

  protected cairo(iso: string) {
    return dayTime(iso, ACADEMY_TZ);
  }
  protected cairoTime(iso: string) {
    return dayTime(iso, ACADEMY_TZ);
  }
  protected local(l: Lesson) {
    return `${dayTime(l.startsAt, l.student.timezone)} (${l.student.timezone.split('/').pop()?.replace(/_/g, ' ')})`;
  }
  protected type(l: Lesson) {
    return typeLabel(l.type, l.extraReason);
  }
  protected reason(r: string) {
    return (
      {
        BY_STUDENT: 'by the student',
        BY_TEACHER: 'by the teacher',
        BY_ADMIN: 'by the academy',
        UNPAID: 'unpaid',
      }[r] ?? r
    );
  }
  protected open(l: Lesson, tab: LessonTab) {
    this.tab.set(tab);
    this.editing.set(l);
  }
  protected closed(changed: boolean) {
    this.editing.set(null);
    if (changed) {
      this.lesson.reload();
      this.history.reload();
      this.log.reload();
    }
  }
  protected async copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      /* ignore: the link is shown to copy by hand */
    }
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2000);
  }
  protected readonly time = time;
  protected readonly tier = tierLabel;
}
