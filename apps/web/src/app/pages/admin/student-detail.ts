import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, computed, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ACADEMY_TZ, city, dayTime, time, tierLabel, typeLabel, WEEKDAYS } from '../../core/format';
import type { Invoice, Lesson, StudentDetail, StudentOverview } from '../../core/models';
import { countryName } from '../../core/countries';
import { LessonActionDialog } from '../../shared/lesson-action-dialog';
import { LessonStatus } from '../../shared/lesson-status';
import { ResetPasswordDialog } from '../../shared/reset-password-dialog';
import { SignInToggle } from '../../shared/sign-in-toggle';
import { PageLog } from '../../shared/page-log';

@Component({
  selector: 'app-admin-student-detail',
  imports: [
    PageLog,
    RouterLink,
    LessonStatus,
    LessonActionDialog,
    ResetPasswordDialog,
    SignInToggle,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (student.value(); as s) {
      <div class="page">
        <nav aria-label="Breadcrumb" class="muted">
          <a routerLink="/admin/students">Students</a> / {{ s.fullName }}
        </nav>
        <header class="page-head">
          <div>
            <h1>
              {{ s.fullName }}
              <span class="chip" [class.ok]="s.status === 'ACTIVE'">{{
                s.status.toLowerCase()
              }}</span>
              @if (!s.signInActive) {
                &ngsp;<span class="chip danger">sign-in off</span>
              }
            </h1>
            <p>
              {{ countryName(s.country) || city(s.timezone) }} · {{ s.timezone }} · {{ s.email
              }}{{ s.phone ? ' · ' + s.phone : '' }}
            </p>
          </div>
          <div class="head-actions">
            <a class="btn" [routerLink]="['/admin/students', s.id, 'calendar']">Calendar</a>
            <a class="btn" [routerLink]="['/admin/students', s.id, 'edit']">Edit</a>
            <button
              type="button"
              class="btn"
              (click)="resetFor.set({ userId: s.userId, name: s.fullName })"
            >
              Reset password
            </button>
            <app-sign-in-toggle
              [userId]="s.userId"
              [name]="s.fullName"
              [active]="s.signInActive"
              (changed)="student.reload()"
            />
            @if (overview.value()?.subscription; as sub) {
              <a class="btn" [routerLink]="['/admin/subscriptions', sub.id]">Manage subscription</a>
            }
            <a class="btn primary" [routerLink]="['/admin/students', s.id, 'add-lesson']"
              >Add a lesson</a
            >
          </div>
        </header>

        <div class="cols">
          <div class="main">
            @if (overview.value()?.subscription; as sub) {
              <section class="card">
                <div class="row">
                  <h2>Subscription</h2>
                  @if (overview.value()?.cycle; as c) {
                    <span class="muted"
                      >Cycle {{ c.index }} · {{ c.startDate }} – {{ c.endDate }}</span
                    >
                  }
                </div>
                <div class="facts">
                  <div>
                    <span class="muted">Plan</span><strong>{{ sub.plan.name }}</strong>
                  </div>
                  <div>
                    <span class="muted">Frequency</span
                    ><strong
                      >{{ sub.lessonsPerWeek }}/week · {{ sub.lessonsPerWeek * 4 }} per
                      cycle</strong
                    >
                  </div>
                  <div>
                    <span class="muted">Teacher</span
                    ><strong
                      ><a [routerLink]="['/admin/teachers', sub.teacherId]">{{
                        sub.teacher
                      }}</a></strong
                    >
                  </div>
                  <div>
                    <span class="muted">Curriculum</span><strong>{{ sub.curriculum }}</strong>
                  </div>
                </div>
                <p class="notice ok">
                  {{ slotText(sub.slots) }} {{ city(sub.timezone) }} time · fixed to the student's
                  clock
                </p>
                <div class="link-box" aria-label="Teacher's meeting link" role="group">
                  <span class="muted small">{{ sub.teacher }}'s meeting link</span>
                  @if (sub.teacherLink; as link) {
                    <code class="link-text">{{ link }}</code>
                    <div class="link-actions">
                      <button type="button" class="btn small primary" (click)="copy(link)">
                        {{ copied() ? 'Copied' : 'Copy link' }}
                      </button>
                      <a class="btn small" [href]="link" target="_blank" rel="noopener">Open</a>
                    </div>
                  } @else {
                    <span
                      >Not set yet.
                      <a [routerLink]="['/admin/teachers', sub.teacherId, 'edit']"
                        >Add it on the teacher's page</a
                      ></span
                    >
                  }
                </div>
              </section>
            } @else {
              <section class="card">
                <h2>Subscription</h2>
                <p class="muted">No active subscription.</p>
                <div>
                  <a
                    class="btn primary"
                    [routerLink]="['/admin/students', s.id, 'add-lesson']"
                    [queryParams]="{ kind: 'weekly' }"
                    >Add weekly lessons</a
                  >
                </div>
              </section>
            }

            <section class="card flush">
              <div class="card-head"><h2>Lessons</h2></div>
              <div class="table-wrap">
                <table class="data" style="min-width: 640px">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (l of lessons.value(); track l.id) {
                      <tr>
                        <td class="num">
                          {{ when(l.startsAt, l.student.timezone)
                          }}<span class="sub"
                            >{{ cairo(l.startsAt) }} Cairo · {{ l.teacher.name }}</span
                          >
                        </td>
                        <td>{{ type(l) }}</td>
                        <td><app-lesson-status [lesson]="l" /></td>
                        <td style="text-align: right">
                          @if (l.status === 'SCHEDULED') {
                            <button type="button" class="btn small" (click)="editing.set(l)">
                              Change
                            </button>
                          }
                        </td>
                      </tr>
                    } @empty {
                      <tr>
                        <td colspan="4" class="empty">No lessons yet.</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div class="side">
            <section class="card contact" aria-labelledby="contact-title">
              <h2 id="contact-title">Contact</h2>
              <dl>
                <dt>Email</dt>
                <dd>
                  <a [href]="'mailto:' + s.email">{{ s.email }}</a>
                </dd>
                <dt>Phone</dt>
                <dd>
                  @if (s.phone) {
                    <a [href]="'tel:' + s.phone">{{ s.phone }}</a>
                    · <a [href]="whatsapp(s.phone)" target="_blank" rel="noopener">WhatsApp</a>
                  } @else {
                    <span class="muted">—</span>
                  }
                </dd>
                <dt>Country</dt>
                <dd>{{ countryName(s.country) || '—' }}</dd>
                <dt>Time zone</dt>
                <dd>{{ s.timezone }} · now {{ nowIn(s.timezone) }}</dd>
                <dt>Address</dt>
                <dd class="addr">{{ s.address || '—' }}</dd>
              </dl>
            </section>
            @if (overview.value(); as o) {
              <section class="card">
                <h2>Quota this cycle</h2>
                <div class="row">
                  <span>Cancellations</span
                  ><strong>{{
                    quota(o.cycle?.cancelsUsed, o.subscription?.plan?.cancelQuota)
                  }}</strong>
                </div>
                <div class="row">
                  <span>Reschedules</span
                  ><strong>{{
                    quota(o.cycle?.reschedulesUsed, o.subscription?.plan?.rescheduleQuota)
                  }}</strong>
                </div>
                <div class="row">
                  <span>Lesson credits waiting</span><strong>{{ o.pendingCredits }}</strong>
                </div>
              </section>
            }
            <section class="card">
              <h2>Invoices</h2>
              @for (inv of invoices.value(); track inv.id) {
                <div class="row">
                  <span
                    ><a [routerLink]="['/admin/invoices', inv.id]">{{ inv.number }}</a>
                    <span class="muted">· cycle {{ inv.cycleIndex }}</span></span
                  >
                  <a
                    class="chip"
                    [routerLink]="['/admin/invoices', inv.id]"
                    [attr.aria-label]="'Open ' + inv.number + ' (' + inv.status.toLowerCase() + ')'"
                    [class.ok]="inv.status === 'PAID'"
                    [class.danger]="inv.status === 'OPEN'"
                    >{{ inv.status.toLowerCase() }}</a
                  >
                </div>
              } @empty {
                <p class="muted">No invoices yet.</p>
              }
              <a routerLink="/admin/invoices">All invoices</a>
            </section>
          </div>
        </div>
        <app-page-log [studentId]="s.id" />
      </div>
      <app-lesson-action-dialog [lesson]="editing()" (closed)="onClosed($event)" />
      <app-reset-password-dialog [person]="resetFor()" (closed)="resetFor.set(null)" />
    } @else if (student.error()) {
      <p class="empty">Student not found.</p>
    } @else {
      <p class="empty">Loading…</p>
    }
  `,
  styles: `
    .contact h2 {
      margin: 0 0 10px;
    }
    .contact dl {
      margin: 0;
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 6px 12px;
      font-size: 14px;
    }
    .contact dt {
      color: var(--muted);
    }
    .contact dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .contact .addr {
      white-space: pre-line;
    }
    .link-box {
      margin-top: 12px;
      padding: 12px 14px;
      border: 1px dashed var(--border-strong);
      border-radius: 10px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
    }
    .link-box > .muted {
      width: 100%;
    }
    .link-text {
      flex: 1 1 240px;
      min-width: 0;
      overflow-wrap: anywhere;
      font-size: 13px;
    }
    .link-actions {
      display: flex;
      gap: 6px;
    }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .facts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 16px;
    }
    .facts div {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .facts span {
      font-size: 12px;
    }
    .notice {
      margin: 0;
    }
    .head-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    h1 .chip {
      vertical-align: middle;
      margin-left: 8px;
    }
  `,
})
export class AdminStudentDetail {
  readonly id = input.required<string>();
  protected readonly student = httpResource<StudentDetail>(() => `/api/students/${this.id()}`);
  protected readonly countryName = countryName;
  protected nowIn(tz: string) {
    return time(new Date(), tz);
  }
  /** wa.me link from a phone number (digits only) */
  protected whatsapp(phone: string) {
    return `https://wa.me/${phone.replace(/[^0-9]/g, '')}`;
  }
  protected readonly copied = signal(false);
  /** Copy the teacher's link to send to the student. */
  protected async copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // older browsers / no permission: select-and-copy fallback
      const t = document.createElement('textarea');
      t.value = link;
      document.body.append(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2000);
  }
  protected readonly overview = httpResource<StudentOverview>(
    () => `/api/students/${this.id()}/overview`,
  );
  protected readonly lessons = httpResource<Lesson[]>(
    () => ({ url: '/api/lessons', params: { studentId: this.id(), from: this.since() } }),
    { defaultValue: [] },
  );
  protected readonly invoices = httpResource<Invoice[]>(
    () => ({ url: '/api/invoices', params: { studentId: this.id() } }),
    {
      defaultValue: [],
    },
  );
  protected readonly editing = signal<Lesson | null>(null);
  protected readonly resetFor = signal<{ userId: string; name: string } | null>(null);
  private readonly since = computed(
    () =>
      this.overview.value()?.cycle?.startDate ??
      new Date(Date.now() - 28 * 86_400_000).toISOString(),
  );

  protected readonly city = city;
  protected readonly when = dayTime;
  protected readonly tier = tierLabel;
  protected cairo(iso: string) {
    return time(iso, ACADEMY_TZ);
  }
  protected type(l: Lesson) {
    return typeLabel(l.type, l.extraReason);
  }
  protected slotText(slots: { weekday: number; startTime: string }[]) {
    return slots.map((s) => `${WEEKDAYS[s.weekday - 1]} ${s.startTime}`).join(' · ');
  }
  protected quota(used: number | undefined, max: number | null | undefined) {
    return max === null || max === undefined
      ? `${used ?? 0} used · unlimited`
      : `${used ?? 0} of ${max} used`;
  }
  protected onClosed(changed: boolean) {
    this.editing.set(null);
    if (changed) {
      this.lessons.reload();
      this.overview.reload();
    }
  }
}
