import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { countryName } from '../../core/countries';
import {
  ACADEMY_TZ,
  city,
  dayTime,
  minutesToClock,
  money,
  tierLabel,
  WEEKDAYS,
} from '../../core/format';
import type {
  Payout,
  PayoutMethod,
  TeacherBank,
  TeacherDetail,
  TeacherNote,
  TeacherRecord,
} from '../../core/models';
import { PageLog } from '../../shared/page-log';
import { ResetPasswordDialog } from '../../shared/reset-password-dialog';
import { SignInToggle } from '../../shared/sign-in-toggle';

/** Weekday order used in Egypt: Saturday first. */
const ORDER = [6, 7, 1, 2, 3, 4, 5];
const START = 8 * 60;
const SPAN = 18 * 60; // 8 AM to 2 AM

type Tab = 'overview' | 'students' | 'attendance' | 'personal' | 'pay' | 'notes' | 'activity';

const METHODS: Record<PayoutMethod, string> = {
  BANK: 'Bank transfer',
  INSTAPAY: 'InstaPay',
  WALLET: 'Mobile wallet',
  CASH: 'Cash',
};

const INCIDENT: Record<TeacherRecord['incidents'][number]['kind'], string> = {
  NO_SHOW: 'Did not come',
  CANCELLED: 'Cancelled by the teacher',
  NOBODY_CAME: 'Nobody came',
};

/**
 * A teacher's file: the essentials on top, then one tab per subject so
 * nothing piles up: overview, students, attendance, personal details,
 * pay and bank (admins), staff notes, and the activity.
 */
@Component({
  selector: 'app-admin-teacher-detail',
  imports: [FormsModule, PageLog, RouterLink, ResetPasswordDialog, SignInToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (teacher.value(); as t) {
      <div class="page">
        <nav aria-label="Breadcrumb" class="muted">
          <a routerLink="/admin/teachers">Teachers</a> / {{ t.fullName }}
        </nav>

        <header class="profile-head">
          <span class="avatar" aria-hidden="true">{{ initials(t.fullName) }}</span>
          <div class="who">
            <h1>{{ t.fullName }}</h1>
            <div class="tags">
              <span class="chip level">{{ tier(t.level) }} level</span>
              @if (t.status === 'INACTIVE') {
                <span class="chip warn">Not taking students</span>
              } @else {
                <span class="chip ok">Active</span>
              }
              @if (!t.signInActive) {
                <span class="chip danger">Sign-in off</span>
              }
            </div>
            <p class="muted line">
              {{ t.email }}{{ t.phone ? ' · ' + t.phone : '' }}
              @if (t.joinedOn) {
                · with the academy since {{ monthYear(t.joinedOn) }}
              }
            </p>
          </div>
          <div class="head-actions">
            <a class="btn" [routerLink]="['/admin/teachers', t.id, 'calendar']">Calendar</a>
            <a class="btn" [routerLink]="['/admin/teachers', t.id, 'availability']">Weekly hours</a>
            <button
              type="button"
              class="btn"
              (click)="resetFor.set({ userId: t.userId, name: t.fullName })"
            >
              Reset password
            </button>
            <app-sign-in-toggle
              [userId]="t.userId"
              [name]="t.fullName"
              [active]="t.signInActive"
              (changed)="teacher.reload()"
            />
            <a class="btn primary" [routerLink]="['/admin/teachers', t.id, 'edit']">Edit</a>
          </div>
        </header>

        <section class="kpis" aria-label="At a glance">
          <div class="kpi">
            <span class="k">Active students</span>
            <strong>{{ t.students.length }}</strong>
            <span class="s">{{ weeklyLessons(t) }} lessons a week</span>
          </div>
          <div class="kpi">
            <span class="k">Held this month</span>
            <strong>{{ thisMonth()?.held ?? '—' }}</strong>
            <span class="s">{{ hoursText(thisMonth()?.heldMinutes ?? 0) }}</span>
          </div>
          <div class="kpi" [class.alert]="t.cancelsThisMonth.used >= t.cancelsThisMonth.limit">
            <span class="k">Cancelled this month</span>
            <strong>{{ t.cancelsThisMonth.used }} / {{ t.cancelsThisMonth.limit }}</strong>
            <span class="s">allowed per month</span>
          </div>
          <div class="kpi" [class.alert]="noShows() > 0">
            <span class="k">Did not come</span>
            <strong>{{ record.value() ? noShows() : '—' }}</strong>
            <span class="s">last 6 months</span>
          </div>
        </section>

        <div class="tabs" role="tablist" aria-label="Teacher file">
          @for (x of tabs(); track x.id) {
            <button
              type="button"
              role="tab"
              [id]="'tt-' + x.id"
              [attr.aria-selected]="tab() === x.id"
              [attr.aria-controls]="'tp-' + x.id"
              (click)="go(x.id)"
            >
              {{ x.label }}
              @if (x.count !== undefined) {
                <span class="count">{{ x.count }}</span>
              }
            </button>
          }
        </div>

        <div
          class="panel"
          role="tabpanel"
          [id]="'tp-' + tab()"
          [attr.aria-labelledby]="'tt-' + tab()"
        >
          @switch (tab()) {
            @case ('overview') {
              <div class="cols2">
                <section class="card">
                  <h2>Teaching</h2>
                  <dl class="facts">
                    <dt>Level</dt>
                    <dd>{{ tier(t.level) }}</dd>
                    <dt>Curricula</dt>
                    <dd>
                      <span class="chips">
                        @for (c of t.curricula; track c.id) {
                          <span class="chip">{{ c.name }}</span>
                        } @empty {
                          <span class="muted">None yet</span>
                        }
                      </span>
                    </dd>
                    <dt>Meeting link</dt>
                    <dd>
                      @if (t.zoomLink) {
                        <a [href]="t.zoomLink" target="_blank" rel="noopener">{{ t.zoomLink }}</a>
                      } @else {
                        <span class="muted">Not set</span>
                      }
                    </dd>
                    <dt>Languages</dt>
                    <dd>{{ t.languages || '—' }}</dd>
                    <dt>Experience</dt>
                    <dd>{{ t.experienceYears !== null ? yearsText(t.experienceYears) : '—' }}</dd>
                  </dl>
                  @if (t.bio) {
                    <p class="bio">{{ t.bio }}</p>
                  }
                </section>
                <section class="card">
                  <div class="row-head">
                    <h2>Latest notes</h2>
                    <button type="button" class="btn small" (click)="go('notes')">All notes</button>
                  </div>
                  @for (n of notes.value().slice(0, 2); track n.id) {
                    <article class="note">
                      <p>{{ n.body }}</p>
                      <span class="muted small"
                        >{{ n.authorName ?? 'Someone' }} · {{ when(n.createdAt) }}</span
                      >
                    </article>
                  } @empty {
                    <p class="muted">No notes yet.</p>
                  }
                </section>
              </div>
              <section class="card">
                <h2>Weekly hours</h2>
                <p class="muted small">Cairo time. Students reschedule only into these hours.</p>
                <div class="table-wrap">
                  <div class="week">
                    @for (d of days(); track d.weekday) {
                      <span class="dlabel">{{ d.label }}</span>
                      <div
                        class="track"
                        role="img"
                        [attr.aria-label]="d.label + ': ' + (d.text || 'day off')"
                      >
                        @for (w of d.windows; track w.left) {
                          <span
                            class="open"
                            [style.left.%]="w.left"
                            [style.width.%]="w.width"
                          ></span>
                        }
                        @if (!d.windows.length) {
                          <span class="off">Day off</span>
                        }
                      </div>
                    }
                  </div>
                </div>
              </section>
            }

            @case ('students') {
              <section class="card flush">
                <div class="card-head">
                  <h2>
                    {{ t.students.length }} active
                    {{ t.students.length === 1 ? 'student' : 'students' }}
                  </h2>
                  <span class="muted small">{{ weeklyLessons(t) }} lessons a week in total</span>
                </div>
                <div class="table-wrap">
                  <table class="data" aria-label="Students">
                    <thead>
                      <tr>
                        <th>Student</th>
                        <th>Curriculum</th>
                        <th>Plan</th>
                        <th>Weekly lessons (their time)</th>
                        <th>Since</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (s of t.students; track s.subscriptionId) {
                        <tr>
                          <td>
                            <a [routerLink]="['/admin/students', s.studentId]"
                              ><strong>{{ s.fullName }}</strong></a
                            >
                            <span class="sub"
                              >{{ countryName(s.country) || city(s.timezone) }} ·
                              {{ s.email }}</span
                            >
                          </td>
                          <td>{{ s.curriculum }}</td>
                          <td>{{ s.planName }} · {{ s.lessonsPerWeek }}/week</td>
                          <td>{{ slots(s.slots) }}</td>
                          <td class="num">{{ shortDate(s.startDate) }}</td>
                        </tr>
                      } @empty {
                        <tr>
                          <td colspan="5" class="empty">No students yet.</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            }

            @case ('attendance') {
              <section class="card flush">
                <div class="card-head">
                  <h2>Month by month</h2>
                  <span class="muted small">Cairo months · lessons that have ended</span>
                </div>
                <div class="table-wrap">
                  <table class="data" aria-label="Attendance by month">
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th class="num">Held</th>
                        <th class="num">Hours</th>
                        <th class="num">Student absent</th>
                        <th class="num">Teacher did not come</th>
                        <th class="num">Cancelled by teacher</th>
                        <th class="num">Nobody came</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (m of record.value()?.months ?? []; track m.month) {
                        <tr>
                          <td>{{ m.label }}</td>
                          <td class="num">{{ m.held }}</td>
                          <td class="num">{{ hours(m.heldMinutes) }}</td>
                          <td class="num">{{ m.studentAbsent }}</td>
                          <td class="num" [class.bad]="m.noShow">{{ m.noShow }}</td>
                          <td class="num" [class.bad]="m.cancelled">{{ m.cancelled }}</td>
                          <td class="num" [class.bad]="m.nobodyCame">{{ m.nobodyCame }}</td>
                        </tr>
                      } @empty {
                        <tr>
                          <td colspan="7" class="empty">
                            {{ record.isLoading() ? 'Loading…' : 'Nothing yet.' }}
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </section>
              <section class="card flush">
                <div class="card-head">
                  <h2>Absences and cancellations</h2>
                  <span class="muted small">Newest first</span>
                </div>
                <ul class="incidents">
                  @for (i of record.value()?.incidents ?? []; track i.lessonId) {
                    <li>
                      <span class="when">{{ cairo(i.startsAt) }}</span>
                      <span
                        class="chip"
                        [class.danger]="i.kind === 'NO_SHOW'"
                        [class.warn]="i.kind !== 'NO_SHOW'"
                        >{{ incident(i.kind) }}</span
                      >
                      <a [routerLink]="['/admin/students', i.studentId]">{{ i.studentName }}</a>
                      <span class="muted">{{
                        i.makeupOwed
                          ? 'Makeup owed to the student'
                          : i.kind === 'NOBODY_CAME'
                            ? ''
                            : 'Settled'
                      }}</span>
                      <a class="open-link" [routerLink]="['/admin/lessons', i.lessonId]"
                        >Open lesson</a
                      >
                    </li>
                  } @empty {
                    <li class="empty">None in the last 6 months.</li>
                  }
                </ul>
              </section>
            }

            @case ('personal') {
              <div class="cols2">
                <section class="card">
                  <h2>Contact</h2>
                  <dl class="facts">
                    <dt>Email</dt>
                    <dd>
                      <a [href]="'mailto:' + t.email">{{ t.email }}</a>
                    </dd>
                    <dt>Phone</dt>
                    <dd>
                      @if (t.phone) {
                        {{ t.phone }} ·
                        <a [href]="whatsapp(t.phone)" target="_blank" rel="noopener">WhatsApp</a>
                      } @else {
                        <span class="muted">Not added</span>
                      }
                    </dd>
                    <dt>Country</dt>
                    <dd>{{ countryName(t.country) || '—' }}</dd>
                    <dt>City</dt>
                    <dd>{{ t.city || '—' }}</dd>
                    <dt>Address</dt>
                    <dd>{{ t.address || '—' }}</dd>
                  </dl>
                </section>
                <section class="card">
                  <h2>About</h2>
                  <dl class="facts">
                    <dt>Gender</dt>
                    <dd>
                      {{ t.gender === 'MALE' ? 'Male' : t.gender === 'FEMALE' ? 'Female' : '—' }}
                    </dd>
                    <dt>Date of birth</dt>
                    <dd>
                      @if (t.birthDate) {
                        {{ shortDate(t.birthDate) }}
                        <span class="muted">· {{ age(t.birthDate) }} years</span>
                      } @else {
                        —
                      }
                    </dd>
                    <dt>Languages</dt>
                    <dd>{{ t.languages || '—' }}</dd>
                    <dt>Education</dt>
                    <dd class="pre">{{ t.education || '—' }}</dd>
                    <dt>Experience</dt>
                    <dd>{{ t.experienceYears !== null ? yearsText(t.experienceYears) : '—' }}</dd>
                    <dt>Joined</dt>
                    <dd>
                      @if (t.joinedOn) {
                        {{ shortDate(t.joinedOn) }}
                        <span class="muted">· {{ tenure(t.joinedOn) }}</span>
                      } @else {
                        —
                      }
                    </dd>
                  </dl>
                </section>
              </div>
              <div>
                <a class="btn" [routerLink]="['/admin/teachers', t.id, 'edit']">Edit details</a>
              </div>
            }

            @case ('pay') {
              <div class="cols2">
                <section class="card">
                  <h2>Pay</h2>
                  <dl class="facts">
                    <dt>Rate</dt>
                    <dd>{{ payText(t) }}</dd>
                  </dl>
                  <h3>Paid months</h3>
                  <ul class="paid" aria-label="Paid months">
                    @for (p of payouts.value(); track p.id) {
                      <li>
                        <span>{{ monthName(p.month) }}</span>
                        <span class="num">{{ money(p.amountCents, p.currency) }}</span>
                        <span class="sub">{{ p.lessons }} lessons · paid {{ when(p.paidAt) }}</span>
                      </li>
                    } @empty {
                      <li class="muted">None recorded yet. Record them from the Teachers page.</li>
                    }
                  </ul>
                </section>
                <section class="card" aria-labelledby="bank-title">
                  <div class="row-head">
                    <h2 id="bank-title">Payment details</h2>
                    @if (!editingBank()) {
                      <button type="button" class="btn small" (click)="startBank()">Edit</button>
                    }
                  </div>
                  @if (editingBank()) {
                    <form class="bank-form" (ngSubmit)="saveBank(t.id)">
                      <div class="field">
                        <label for="b-method">Paid by</label>
                        <select id="b-method" name="method" [(ngModel)]="draft.method">
                          <option value="">Not set</option>
                          @for (m of methodList; track m.value) {
                            <option [value]="m.value">{{ m.label }}</option>
                          }
                        </select>
                      </div>
                      @if (draft.method === 'BANK' || !draft.method) {
                        <div class="two">
                          <div class="field">
                            <label for="b-bank">Bank</label>
                            <input id="b-bank" name="bankName" [(ngModel)]="draft.bankName" />
                          </div>
                          <div class="field">
                            <label for="b-holder">Account holder</label>
                            <input
                              id="b-holder"
                              name="accountHolder"
                              [(ngModel)]="draft.accountHolder"
                            />
                          </div>
                          <div class="field">
                            <label for="b-acc">Account number</label>
                            <input
                              id="b-acc"
                              name="accountNumber"
                              inputmode="numeric"
                              [(ngModel)]="draft.accountNumber"
                            />
                          </div>
                          <div class="field">
                            <label for="b-iban">IBAN</label>
                            <input id="b-iban" name="iban" [(ngModel)]="draft.iban" />
                          </div>
                        </div>
                      }
                      @if (draft.method === 'INSTAPAY' || !draft.method) {
                        <div class="field">
                          <label for="b-ip">InstaPay address</label>
                          <input
                            id="b-ip"
                            name="instapay"
                            placeholder="name@instapay"
                            [(ngModel)]="draft.instapay"
                          />
                        </div>
                      }
                      @if (draft.method === 'WALLET' || !draft.method) {
                        <div class="field">
                          <label for="b-w">Wallet number</label>
                          <input
                            id="b-w"
                            name="wallet"
                            inputmode="tel"
                            placeholder="010…"
                            [(ngModel)]="draft.wallet"
                          />
                        </div>
                      }
                      <div class="field">
                        <label for="b-notes">Notes</label>
                        <input id="b-notes" name="notes" [(ngModel)]="draft.notes" />
                      </div>
                      <div class="actions">
                        <button class="btn primary" type="submit" [disabled]="busy()">
                          Save details
                        </button>
                        <button class="btn" type="button" (click)="editingBank.set(false)">
                          Cancel
                        </button>
                      </div>
                    </form>
                  } @else if (bank.value(); as b) {
                    @if (!b.method && !b.accountNumber && !b.instapay && !b.wallet) {
                      <p class="muted">Not added yet.</p>
                    } @else {
                      <dl class="facts">
                        <dt>Paid by</dt>
                        <dd>{{ b.method ? methods[b.method] : '—' }}</dd>
                        @if (b.bankName) {
                          <dt>Bank</dt>
                          <dd>{{ b.bankName }}</dd>
                        }
                        @if (b.accountHolder) {
                          <dt>Account holder</dt>
                          <dd>{{ b.accountHolder }}</dd>
                        }
                        @if (b.accountNumber) {
                          <dt>Account number</dt>
                          <dd class="mono">
                            {{ shown() ? b.accountNumber : masked(b.accountNumber) }}
                          </dd>
                        }
                        @if (b.iban) {
                          <dt>IBAN</dt>
                          <dd class="mono">{{ shown() ? b.iban : masked(b.iban) }}</dd>
                        }
                        @if (b.instapay) {
                          <dt>InstaPay</dt>
                          <dd class="mono">{{ b.instapay }}</dd>
                        }
                        @if (b.wallet) {
                          <dt>Wallet</dt>
                          <dd class="mono">{{ shown() ? b.wallet : masked(b.wallet) }}</dd>
                        }
                        @if (b.notes) {
                          <dt>Notes</dt>
                          <dd>{{ b.notes }}</dd>
                        }
                      </dl>
                      @if (b.accountNumber || b.iban || b.wallet) {
                        <button type="button" class="btn small" (click)="shown.set(!shown())">
                          {{ shown() ? 'Hide numbers' : 'Show numbers' }}
                        </button>
                      }
                      @if (b.updatedAt) {
                        <p class="muted small">Last changed {{ when(b.updatedAt) }}</p>
                      }
                    }
                  }
                  <p class="muted small">
                    Only admins see this. The activity says what changed, never the numbers.
                  </p>
                </section>
              </div>
            }

            @case ('notes') {
              <section class="card">
                <h2>Notes about {{ first(t.fullName) }}</h2>
                <p class="muted small">
                  For the academy only: feedback from families, agreements, reminders.
                </p>
                <form class="add-note" (ngSubmit)="addNote(t.id)">
                  <label class="sr-only" for="n-body">New note</label>
                  <textarea
                    id="n-body"
                    name="body"
                    rows="3"
                    placeholder="Write a note…"
                    [(ngModel)]="noteText"
                  ></textarea>
                  <div>
                    <button
                      class="btn primary"
                      type="submit"
                      [disabled]="busy() || noteText.trim().length < 2"
                    >
                      Add note
                    </button>
                  </div>
                </form>
                <div class="notes">
                  @for (n of notes.value(); track n.id) {
                    <article class="note">
                      <p>{{ n.body }}</p>
                      <div class="note-foot">
                        <span class="muted small"
                          >{{ n.authorName ?? 'Someone' }} · {{ when(n.createdAt) }}</span
                        >
                        @if (canRemove(n)) {
                          <button type="button" class="link" (click)="removeNote(t.id, n)">
                            Remove
                          </button>
                        }
                      </div>
                    </article>
                  } @empty {
                    <p class="muted">No notes yet.</p>
                  }
                </div>
              </section>
            }

            @case ('activity') {
              <app-page-log [teacherId]="t.id" />
            }
          }
        </div>
      </div>
      <app-reset-password-dialog [person]="resetFor()" (closed)="resetFor.set(null)" />
    } @else {
      <p class="empty">{{ teacher.error() ? 'Teacher not found.' : 'Loading…' }}</p>
    }
  `,
  styles: `
    .profile-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 16px 18px;
    }
    .avatar {
      display: grid;
      place-items: center;
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: var(--primary);
      color: #fff;
      font-size: 22px;
      font-weight: 700;
      flex: none;
    }
    .who {
      flex: 1;
      min-width: 220px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .chip.level {
      background: var(--accent-tint);
      color: var(--warn-ink);
    }
    .line {
      margin: 0;
    }
    .head-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .kpis {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }
    @media (max-width: 760px) {
      .kpis {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    .kpi {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 14px 16px;
      border-radius: var(--radius);
      background: var(--surface);
      border: 1px solid var(--border);
    }
    .kpi .k {
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .kpi strong {
      font-size: 24px;
      line-height: 1.2;
    }
    .kpi .s {
      font-size: 12px;
      color: var(--muted);
    }
    .kpi.alert {
      border-color: #f0c9a0;
      background: var(--warn-tint);
    }
    .tabs {
      display: flex;
      gap: 2px;
      overflow-x: auto;
      border-bottom: 1px solid var(--border);
    }
    .tabs button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 44px;
      padding: 0 14px;
      border: 0;
      border-bottom: 2px solid transparent;
      background: transparent;
      font: inherit;
      font-weight: 500;
      color: var(--muted);
      white-space: nowrap;
      cursor: pointer;
    }
    .tabs button[aria-selected='true'] {
      color: var(--primary);
      border-bottom-color: var(--primary);
      font-weight: 700;
    }
    .count {
      min-width: 20px;
      padding: 0 6px;
      border-radius: 999px;
      background: var(--neutral-tint);
      font-size: 12px;
      text-align: center;
    }
    .panel {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .cols2 {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
      align-items: start;
    }
    @media (max-width: 860px) {
      .cols2 {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .card h2 {
      font-size: 16px;
      color: var(--ink);
    }
    .card h3 {
      margin: 8px 0 0;
      font-size: 13px;
      color: var(--muted);
    }
    .row-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    .facts {
      display: grid;
      grid-template-columns: 140px minmax(0, 1fr);
      gap: 10px 16px;
      margin: 0;
    }
    .facts dt {
      color: var(--muted);
    }
    .facts dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .pre {
      white-space: pre-line;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .bio {
      margin: 0;
      padding-top: 12px;
      border-top: 1px solid var(--divider);
      color: var(--ink-2);
      white-space: pre-line;
    }
    .week {
      display: grid;
      grid-template-columns: 48px 1fr;
      gap: 10px 12px;
      min-width: 640px;
      align-items: center;
    }
    .dlabel {
      font-weight: 600;
      font-size: 13px;
    }
    .track {
      position: relative;
      height: 28px;
      border-radius: 6px;
      background: #f1f2ee;
    }
    .open {
      position: absolute;
      top: 0;
      bottom: 0;
      background: #cfe3d8;
      border: 1px solid #9cc4ae;
      border-radius: 6px;
    }
    .off {
      position: absolute;
      left: 10px;
      top: 6px;
      font-size: 12px;
      color: var(--muted);
    }
    td.bad {
      color: var(--danger);
      font-weight: 700;
    }
    .incidents {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .incidents li {
      display: grid;
      grid-template-columns: 190px auto minmax(0, 1fr) auto auto;
      gap: 12px;
      align-items: center;
      padding: 12px 20px;
      border-top: 1px solid var(--divider);
    }
    .incidents li.empty {
      display: block;
      color: var(--muted);
    }
    @media (max-width: 760px) {
      .incidents li {
        grid-template-columns: minmax(0, 1fr) auto;
      }
    }
    .when {
      font-variant-numeric: tabular-nums;
    }
    .open-link {
      font-size: 13px;
    }
    .paid {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .paid li {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 0 12px;
    }
    .paid .sub {
      grid-column: 1 / -1;
      font-size: 12px;
      color: var(--muted);
    }
    .bank-form,
    .add-note {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .two {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    @media (max-width: 520px) {
      .two {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .add-note textarea {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      font: inherit;
      resize: vertical;
    }
    .notes {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .note {
      padding: 12px 14px;
      border-radius: 10px;
      background: var(--surface-muted);
      border: 1px solid var(--border);
    }
    .note p {
      margin: 0 0 6px;
      white-space: pre-line;
      line-height: 1.5;
    }
    .note-foot {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    .link {
      border: 0;
      background: none;
      padding: 0;
      color: var(--danger);
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }
    .mono {
      font-family: ui-monospace, monospace;
    }
    .small {
      font-size: 13px;
      margin: 0;
    }
    .actions {
      display: flex;
      gap: 8px;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
    }
  `,
})
export class AdminTeacherDetail {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly id = input.required<string>();
  /** ?tab=students (or attendance, personal, pay, notes, activity) */
  readonly tabParam = input<string | undefined>(undefined, { alias: 'tab' });

  protected readonly teacher = httpResource<TeacherDetail>(() => `/api/teachers/${this.id()}`);
  protected readonly isAdmin = computed(() => this.auth.hasRole('ADMIN'));
  protected readonly record = httpResource<TeacherRecord>(
    () => `/api/teachers/${this.id()}/record`,
  );
  protected readonly notes = httpResource<TeacherNote[]>(() => `/api/teachers/${this.id()}/notes`, {
    defaultValue: [],
  });
  protected readonly bank = httpResource<TeacherBank>(() =>
    this.isAdmin() && this.tab() === 'pay' ? `/api/teachers/${this.id()}/bank` : undefined,
  );
  /** Admins only: the API sends the rate to admins, so ask only then. */
  protected readonly payouts = httpResource<Payout[]>(
    () =>
      this.isAdmin() && this.tab() === 'pay'
        ? { url: '/api/payouts', params: { teacherId: this.id() } }
        : undefined,
    { defaultValue: [] },
  );

  protected readonly tab = linkedSignal<Tab>(() => {
    const t = this.tabParam() as Tab | undefined;
    const known: Tab[] = [
      'overview',
      'students',
      'attendance',
      'personal',
      'pay',
      'notes',
      'activity',
    ];
    return t && known.includes(t) && (t !== 'pay' || this.isAdmin()) ? t : 'overview';
  });
  protected readonly tabs = computed(() => {
    const t = this.teacher.value();
    const list: { id: Tab; label: string; count?: number }[] = [
      { id: 'overview', label: 'Overview' },
      { id: 'students', label: 'Students', count: t?.students.length },
      { id: 'attendance', label: 'Attendance' },
      { id: 'personal', label: 'Personal details' },
    ];
    if (this.isAdmin()) list.push({ id: 'pay', label: 'Pay & bank' });
    list.push(
      { id: 'notes', label: 'Notes', count: this.notes.value().length },
      { id: 'activity', label: 'Activity' },
    );
    return list;
  });

  protected readonly thisMonth = computed(() => this.record.value()?.months[0] ?? null);
  protected readonly noShows = computed(
    () => this.record.value()?.months.reduce((n, m) => n + m.noShow, 0) ?? 0,
  );

  protected readonly resetFor = signal<{ userId: string; name: string } | null>(null);
  protected readonly busy = signal(false);
  protected readonly editingBank = signal(false);
  protected readonly shown = signal(false);
  protected draft: Record<keyof TeacherBank, string> = this.blankDraft();
  protected noteText = '';

  protected readonly methods = METHODS;
  protected readonly methodList = (Object.keys(METHODS) as PayoutMethod[]).map((value) => ({
    value,
    label: METHODS[value],
  }));
  protected readonly tier = tierLabel;
  protected readonly money = money;
  protected readonly city = city;
  protected readonly countryName = countryName;

  protected go(tab: Tab) {
    this.tab.set(tab);
    // Keep the tab in the address, so Back and a shared link land on it.
    void this.router.navigate([], { queryParams: { tab }, replaceUrl: true });
  }

  protected initials(name: string) {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('');
  }
  protected first(name: string) {
    return name.split(' ')[0];
  }
  protected weeklyLessons(t: TeacherDetail) {
    return t.students.reduce((n, s) => n + s.lessonsPerWeek, 0);
  }
  protected hours(minutes: number) {
    return Math.round((minutes / 60) * 10) / 10;
  }
  protected hoursText(minutes: number) {
    const h = this.hours(minutes);
    return `${h} ${h === 1 ? 'hour' : 'hours'}`;
  }
  protected yearsText(n: number) {
    return `${n} ${n === 1 ? 'year' : 'years'}`;
  }
  protected age(birth: string) {
    const b = new Date(`${birth}T12:00:00Z`);
    const now = new Date();
    let a = now.getUTCFullYear() - b.getUTCFullYear();
    const m = now.getUTCMonth() - b.getUTCMonth();
    if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) a--;
    return a;
  }
  protected tenure(since: string) {
    const s = new Date(`${since}T12:00:00Z`);
    const now = new Date();
    const months =
      (now.getUTCFullYear() - s.getUTCFullYear()) * 12 + now.getUTCMonth() - s.getUTCMonth();
    if (months < 1) return 'new this month';
    if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'}`;
    const y = Math.floor(months / 12);
    const r = months % 12;
    return `${y} ${y === 1 ? 'year' : 'years'}${r ? `, ${r} ${r === 1 ? 'month' : 'months'}` : ''}`;
  }
  protected monthYear(date: string) {
    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${date}T12:00:00Z`));
  }
  protected shortDate(date: string) {
    return new Intl.DateTimeFormat('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${date}T12:00:00Z`));
  }
  protected monthName(month: string) {
    return this.monthYear(`${month}-15`);
  }
  protected when(iso: string) {
    return new Intl.DateTimeFormat('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: ACADEMY_TZ,
    }).format(new Date(iso));
  }
  protected cairo(iso: string) {
    return `${dayTime(iso, ACADEMY_TZ)} Cairo`;
  }
  protected incident(kind: keyof typeof INCIDENT) {
    return INCIDENT[kind];
  }
  protected whatsapp(phone: string) {
    return `https://wa.me/${phone.replace(/[^0-9]/g, '')}`;
  }
  protected masked(value: string) {
    const v = value.replace(/\s+/g, '');
    return v.length <= 4 ? '••••' : `•••• ${v.slice(-4)}`;
  }
  protected payText(t: TeacherDetail) {
    const r = t.payRate;
    if (!r || r.rateCents === null)
      return `Not set (no own rate, no ${tierLabel(t.level)} level rate)`;
    const each = `${money(r.rateCents, r.currency)} an hour`;
    return r.source === 'TEACHER'
      ? `${each} (own rate)`
      : `${each} (${tierLabel(t.level)} level rate)`;
  }

  protected readonly days = computed(() => {
    const windows = this.teacher.value()?.availability ?? [];
    return ORDER.map((weekday) => {
      const mine = windows.filter((w) => w.weekday === weekday);
      return {
        weekday,
        label: WEEKDAYS[weekday - 1],
        text: mine
          .map((w) => `${minutesToClock(w.startMinute)} to ${minutesToClock(w.endMinute)}`)
          .join(', '),
        windows: mine.map((w) => {
          const from = Math.max(w.startMinute, START);
          const to = Math.min(w.endMinute, START + SPAN);
          return {
            left: ((from - START) / SPAN) * 100,
            width: (Math.max(0, to - from) / SPAN) * 100,
          };
        }),
      };
    });
  });

  protected slots(slots: { weekday: number; startTime: string }[]) {
    return slots.map((s) => `${WEEKDAYS[s.weekday - 1]} ${s.startTime}`).join(' · ');
  }

  // ----- payment details -----

  private blankDraft(): Record<keyof TeacherBank, string> {
    return {
      method: '',
      bankName: '',
      accountHolder: '',
      accountNumber: '',
      iban: '',
      instapay: '',
      wallet: '',
      notes: '',
      updatedAt: '',
    };
  }

  protected startBank() {
    const b = this.bank.value();
    const d = this.blankDraft();
    if (b) for (const k of Object.keys(d) as (keyof TeacherBank)[]) d[k] = b[k] ?? '';
    this.draft = d;
    this.editingBank.set(true);
  }

  protected async saveBank(id: string) {
    this.busy.set(true);
    try {
      const { updatedAt: _skip, ...body } = this.draft;
      await this.api.setTeacherBank(id, body);
      this.editingBank.set(false);
      this.bank.reload();
    } catch {
      // the message at the top says why
    } finally {
      this.busy.set(false);
    }
  }

  // ----- notes -----

  protected canRemove(n: TeacherNote) {
    return this.isAdmin() || n.authorId === this.auth.user()?.userId;
  }

  protected async addNote(id: string) {
    const text = this.noteText.trim();
    if (text.length < 2) return;
    this.busy.set(true);
    try {
      await this.api.addTeacherNote(id, text);
      this.noteText = '';
      this.notes.reload();
    } catch {
      // the message at the top says why
    } finally {
      this.busy.set(false);
    }
  }

  protected async removeNote(id: string, n: TeacherNote) {
    if (!confirm('Remove this note?')) return;
    try {
      await this.api.removeTeacherNote(id, n.id);
      this.notes.reload();
    } catch {
      // the message at the top says why
    }
  }
}
