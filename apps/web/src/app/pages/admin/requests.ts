import { httpResource } from '@angular/common/http';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { ACADEMY_TZ, addDays, city, dayTime, localDate, time } from '../../core/format';
import type { ChangeRequest, RuleViolationError } from '../../core/models';
import { LessonStatus } from '../../shared/lesson-status';
import { SlotPicker } from '../../shared/slot-picker';
import { Applications } from './applications';
import { ToastService } from '../../core/toast.service';
import { PageLog } from '../../shared/page-log';

interface Draft {
  note: string;
  chosen: string | null;
  error: string;
  canOverride: boolean;
}

const blank = (): Draft => ({ note: '', chosen: null, error: '', canOverride: false });

/** Requests from students and teachers. Approving runs the change; declining needs a reason. */
@Component({
  selector: 'app-admin-requests',
  imports: [PageLog, FormsModule, RouterLink, LessonStatus, SlotPicker, Applications],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="views" role="tablist" aria-label="Requests">
        <button
          type="button"
          role="tab"
          [attr.aria-selected]="view() === 'lessons'"
          [class.on]="view() === 'lessons'"
          (click)="view.set('lessons')"
        >
          Lesson requests
        </button>
        <button
          type="button"
          role="tab"
          [attr.aria-selected]="view() === 'applications'"
          [class.on]="view() === 'applications'"
          (click)="view.set('applications')"
        >
          Website applications
          @if (newApplications.value()?.new; as n) {
            <span class="badge">{{ n }}</span>
          }
        </button>
      </div>
      @if (view() === 'applications') {
        <header class="page-head">
          <div>
            <h1>Website applications</h1>
            <p>
              People who applied on the academy's website. Follow up, add them as students and book
              a trial.
            </p>
          </div>
        </header>
        <details class="card connect">
          <summary>Connect the website form</summary>
          <p>
            The website sends each application to
            <code>{{ origin }}/api/public/applications</code> (a JSON or a plain form post, no
            sign-in). A ready form is in <code>docs/website-form.html</code>: paste it into the site
            (WordPress "Custom HTML", Wix or Webflow "Embed code") and set the two addresses in it.
            On the server, set <code>CORS_ORIGINS</code> to the website's address.
          </p>
        </details>
        <app-applications (changed)="newApplications.reload()" />
      } @else {
        <header class="page-head">
          <div>
            <h1>Requests</h1>
            <p>Students and teachers asking to cancel or move a lesson they can't change online.</p>
          </div>
          <div class="tabs" role="group" aria-label="Show">
            <button
              type="button"
              class="btn small"
              [class.on]="tab() === 'OPEN'"
              [attr.aria-pressed]="tab() === 'OPEN'"
              (click)="tab.set('OPEN')"
            >
              Open
            </button>
            <button
              type="button"
              class="btn small"
              [class.on]="tab() === 'CLOSED'"
              [attr.aria-pressed]="tab() === 'CLOSED'"
              (click)="tab.set('CLOSED')"
            >
              Answered
            </button>
          </div>
        </header>

        <div class="list">
          @for (r of requests.value(); track r.id) {
            <article class="card req" [attr.aria-labelledby]="'rq-' + r.id">
              <div class="top">
                <div>
                  <h2 [id]="'rq-' + r.id">
                    {{ r.kind === 'CANCEL' ? 'Cancel' : 'Move' }} · {{ r.requester.name }}
                    <span class="chip outline">{{ r.requester.kind.toLowerCase() }}</span>
                  </h2>
                  <span class="muted small">Asked {{ cairo(r.createdAt) }} Cairo</span>
                </div>
                @if (r.status !== 'OPEN') {
                  <span
                    class="chip"
                    [class.ok]="r.status === 'APPROVED'"
                    [class.danger]="r.status === 'DECLINED'"
                    >{{ r.status.toLowerCase() }}</span
                  >
                }
              </div>

              @if (r.lesson; as l) {
                <div class="lesson">
                  <div>
                    <strong
                      >{{ when(l.startsAt, l.student.timezone) }} in
                      {{ cityOf(l.student.timezone) }}</strong
                    >
                    <span class="muted small"
                      >{{ cairo(l.startsAt) }} Cairo ·
                      <a [routerLink]="['/admin/students', l.student.id]">{{ l.student.name }}</a>
                      with {{ l.teacher.name }} · {{ l.curriculum }}</span
                    >
                  </div>
                  <app-lesson-status [lesson]="l" />
                </div>
              }

              <blockquote>{{ r.message }}</blockquote>
              @if (r.preferredTimes) {
                <p class="small">
                  <span class="muted">Times that suit them:</span> {{ r.preferredTimes }}
                </p>
              }

              @if (r.status === 'OPEN') {
                @if (r.rules.length) {
                  <p class="notice warn">
                    <span
                      ><strong>{{
                        r.requester.kind === 'TEACHER'
                          ? 'Past the teacher’s limit:'
                          : 'Online this is blocked:'
                      }}</strong>
                      {{ ruleText(r) }}</span
                    >
                  </p>
                }
                @if (r.lesson && r.lesson.status !== 'SCHEDULED') {
                  <p class="notice warn">
                    <span>The lesson was already changed, so only declining is left.</span>
                  </p>
                } @else if (r.lesson && r.kind === 'RESCHEDULE') {
                  <app-slot-picker
                    [lessonId]="r.lesson.id"
                    [timezone]="r.lesson.student.timezone"
                    [startDate]="firstDay(r)"
                    [(chosen)]="d(r.id).chosen"
                  />
                }

                <div class="field">
                  <label [attr.for]="'note-' + r.id"
                    >Reply to {{ r.requester.name.split(' ')[0] }}
                    <span class="muted">(needed to decline)</span></label
                  >
                  <input [id]="'note-' + r.id" [(ngModel)]="d(r.id).note" maxlength="500" />
                </div>

                <div class="actions">
                  @if (r.lesson?.status === 'SCHEDULED') {
                    @if (r.kind === 'RESCHEDULE') {
                      <button
                        type="button"
                        class="btn primary"
                        [disabled]="busy() || !d(r.id).chosen"
                        (click)="approve(r, {})"
                      >
                        Move to the chosen time
                      </button>
                      @if (d(r.id).canOverride) {
                        <button
                          type="button"
                          class="btn"
                          [disabled]="busy()"
                          (click)="approve(r, { override: true })"
                        >
                          Move anyway
                        </button>
                      }
                    } @else if (overLimit(r)) {
                      <!-- Past the teacher's 4 a month: logged as an override. -->
                      <button
                        type="button"
                        class="btn primary"
                        [disabled]="busy()"
                        (click)="approve(r, { teacherRemedy: 'MAKEUP', override: true })"
                      >
                        Cancel anyway, makeup owed
                      </button>
                      <button
                        type="button"
                        class="btn"
                        [disabled]="busy()"
                        (click)="approve(r, { teacherRemedy: 'CREDIT', override: true })"
                      >
                        Cancel anyway, credit to the student
                      </button>
                    } @else if (r.requester.kind === 'TEACHER') {
                      <button
                        type="button"
                        class="btn primary"
                        [disabled]="busy()"
                        (click)="approve(r, { teacherRemedy: 'MAKEUP' })"
                      >
                        Cancel, makeup owed
                      </button>
                      <button
                        type="button"
                        class="btn"
                        [disabled]="busy()"
                        (click)="approve(r, { teacherRemedy: 'CREDIT' })"
                      >
                        Cancel, credit to the student
                      </button>
                    } @else if (r.rules.length) {
                      <button
                        type="button"
                        class="btn primary"
                        [disabled]="busy()"
                        (click)="approve(r, { credit: false })"
                      >
                        Cancel, counts as taken
                      </button>
                      <button
                        type="button"
                        class="btn"
                        [disabled]="busy()"
                        (click)="approve(r, { credit: true })"
                      >
                        Cancel with a credit
                      </button>
                    } @else {
                      <button
                        type="button"
                        class="btn primary"
                        [disabled]="busy()"
                        (click)="approve(r, { credit: false })"
                      >
                        Cancel with a credit
                      </button>
                    }
                  }
                  <button
                    type="button"
                    class="btn danger"
                    [disabled]="busy() || !d(r.id).note.trim()"
                    (click)="decline(r)"
                  >
                    Decline
                  </button>
                </div>
              } @else {
                <p class="small">
                  <span class="muted"
                    >{{
                      r.status === 'WITHDRAWN'
                        ? 'Withdrawn'
                        : 'Answered by ' + (r.resolvedBy ?? '—')
                    }}
                    · {{ r.resolvedAt ? cairo(r.resolvedAt) + ' Cairo' : '' }}</span
                  >
                  @if (r.resolutionNote) {
                    <br />{{ r.resolutionNote }}
                  }
                </p>
              }
            </article>
          } @empty {
            <p class="card empty">
              {{
                requests.isLoading()
                  ? 'Loading…'
                  : tab() === 'OPEN'
                    ? 'No open requests.'
                    : 'Nothing answered yet.'
              }}
            </p>
          }
        </div>
      }
      <app-page-log title="Activity on requests" actions="request.,application." />
    </div>
  `,
  styles: `
    .views {
      display: flex;
      gap: 4px;
      border-bottom: 1px solid var(--border);
    }
    .views button {
      border: 0;
      background: none;
      font: inherit;
      font-size: 14px;
      font-weight: 600;
      color: var(--muted);
      padding: 10px 14px;
      border-bottom: 3px solid transparent;
      margin-bottom: -1px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .views button.on {
      color: var(--primary);
      border-bottom-color: var(--primary);
    }
    .connect summary {
      cursor: pointer;
      font-weight: 600;
    }
    .connect p {
      margin: 10px 0 0;
      font-size: 14px;
    }
    .views .badge {
      background: var(--accent);
      color: var(--ink);
      border-radius: 999px;
      font-size: 11px;
      padding: 1px 7px;
    }
    .tabs {
      display: flex;
      gap: 6px;
    }
    .tabs .on {
      background: var(--primary-tint);
      border-color: var(--primary);
      color: var(--primary);
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: 14px;
      max-width: 920px;
    }
    .req {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .top,
    .lesson {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px 16px;
    }
    .top > div,
    .lesson > div {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .lesson {
      padding: 12px 14px;
      background: var(--surface-muted);
      border-radius: 10px;
    }
    h2 {
      font-size: 16px;
      margin: 0;
    }
    h2 .chip {
      vertical-align: middle;
      margin-left: 6px;
    }
    blockquote {
      margin: 0;
      padding: 2px 0 2px 14px;
      border-left: 3px solid var(--border-strong);
      white-space: pre-line;
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
export class AdminRequests {
  private readonly api = inject(ApiService);
  protected readonly tab = signal<'OPEN' | 'CLOSED'>('OPEN');
  /** ?tab=applications opens the website applications (e.g. from the email) */
  readonly tabParam = input<string | undefined>(undefined, { alias: 'tab' });
  protected readonly view = linkedSignal<'lessons' | 'applications'>(() =>
    this.tabParam() === 'applications' ? 'applications' : 'lessons',
  );
  protected readonly origin = location.origin;
  protected readonly newApplications = httpResource<{ new: number }>(
    () => '/api/applications/summary',
  );
  protected readonly busy = signal(false);
  private readonly toast = inject(ToastService);
  /** Per-request form state. Changes always end with a signal update (busy), which re-renders. */
  private readonly drafts = new Map<string, Draft>();

  protected readonly requests = httpResource<ChangeRequest[]>(
    () => ({ url: '/api/requests', params: { status: this.tab() } }),
    {
      defaultValue: [],
    },
  );

  protected d(id: string): Draft {
    let draft = this.drafts.get(id);
    if (!draft) {
      draft = blank();
      this.drafts.set(id, draft);
    }
    return draft;
  }

  protected when = dayTime;
  protected cityOf = city;
  protected cairo(iso: string) {
    return `${dayTime(iso, ACADEMY_TZ).split(' · ')[0]} ${time(iso, ACADEMY_TZ)}`;
  }
  /** A teacher's cancel request past the monthly limit. */
  protected overLimit(r: ChangeRequest) {
    return (
      r.kind === 'CANCEL' &&
      r.requester.kind === 'TEACHER' &&
      r.rules.some((v) => v.code === 'TEACHER_CANCEL_LIMIT')
    );
  }
  protected ruleText(r: ChangeRequest) {
    return r.rules.map((v) => v.message).join(' ');
  }
  /** The lesson's own day if it is still ahead, else tomorrow. */
  protected firstDay(r: ChangeRequest) {
    const l = r.lesson!;
    const today = localDate(new Date(), l.student.timezone);
    const day = localDate(l.startsAt, l.student.timezone);
    return day > today ? day : addDays(today, 1);
  }

  private patch(id: string, change: Partial<Draft>) {
    Object.assign(this.d(id), change);
  }

  protected async approve(
    r: ChangeRequest,
    opts: { credit?: boolean; teacherRemedy?: 'MAKEUP' | 'CREDIT'; override?: boolean },
  ) {
    const draft = this.d(r.id);
    this.busy.set(true);
    this.patch(r.id, { error: '' });
    try {
      await this.api.approveRequest(r.id, {
        ...opts,
        note: draft.note.trim() || undefined,
        startsAt: r.kind === 'RESCHEDULE' ? (draft.chosen ?? undefined) : undefined,
      });
      this.toast.success(`${r.requester.name}'s request was approved.`);
      this.requests.reload();
    } catch (err) {
      const body =
        err instanceof HttpErrorResponse ? (err.error as Partial<RuleViolationError>) : null;
      this.patch(r.id, { error: errorMessage(err), canOverride: !!body?.canOverride });
    } finally {
      this.busy.set(false);
    }
  }

  protected async decline(r: ChangeRequest) {
    this.busy.set(true);
    this.patch(r.id, { error: '' });
    try {
      await this.api.declineRequest(r.id, this.d(r.id).note.trim());
      this.toast.success(`${r.requester.name}'s request was declined.`);
      this.requests.reload();
    } catch (err) {
      this.patch(r.id, { error: errorMessage(err) });
    } finally {
      this.busy.set(false);
    }
  }
}
