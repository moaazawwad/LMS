import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { ACADEMY_TZ, dayTime, tierLabel, time } from '../../core/format';
import { ruleError } from '../../core/forms';
import type { Lesson, StudentDetail, TeacherRow, Tier } from '../../core/models';
import { ToastService } from '../../core/toast.service';

type Span = 'all' | 'some';

interface TransferOption {
  teacherId: string;
  name: string;
  level: Tier;
  lessons: number;
  outsideHours: number;
  busy: number;
  levelTooLow: boolean;
}

/**
 * Move a student's lessons to another teacher: all upcoming lessons for good,
 * or only some of them (a stand-in). Nothing else happens here: adding,
 * moving or cancelling lessons have their own actions.
 */
@Component({
  selector: 'app-admin-transfer',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      @if (student.value(); as s) {
        <nav aria-label="Breadcrumb" class="muted">
          <a routerLink="/admin/students">Students</a> /
          <a [routerLink]="['/admin/students', s.id]">{{ s.fullName }}</a> / Transfer
        </nav>
        <header class="page-head">
          <div>
            <h1>Transfer</h1>
            @if (current(); as c) {
              <p>
                {{ s.fullName }}'s {{ c.curriculum }} lessons are with
                <strong>{{ c.teacher.name }}</strong
                >.
              </p>
            }
          </div>
        </header>

        @if (!subs().length) {
          <p class="empty">{{ first(s.fullName) }} has no weekly lessons to transfer.</p>
        } @else {
          <div class="steps">
            @if (subs().length > 1) {
              <div class="field narrow-field">
                <label for="tr-sub">Lessons</label>
                <select id="tr-sub" [ngModel]="subId()" (ngModelChange)="subId.set($event)">
                  @for (x of subs(); track x.id) {
                    <option [value]="x.id">{{ x.curriculum }} with {{ x.teacher.name }}</option>
                  }
                </select>
              </div>
            }

            <section class="card step" aria-labelledby="tr-span">
              <h2 id="tr-span"><span class="num">1</span> For how long?</h2>
              <div class="choices" role="radiogroup" aria-labelledby="tr-span">
                <button
                  type="button"
                  role="radio"
                  class="choice"
                  [attr.aria-checked]="span() === 'all'"
                  (click)="span.set('all')"
                >
                  <strong>For good</strong>
                  <span>All upcoming lessons and the weekly times move to the new teacher.</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  class="choice"
                  [attr.aria-checked]="span() === 'some'"
                  (click)="span.set('some')"
                >
                  <strong>For some lessons</strong>
                  <span>A stand-in: only the lessons you pick; the rest stay as they are.</span>
                </button>
              </div>

              @if (span() === 'some') {
                <fieldset class="lessons">
                  <legend>Lessons to transfer ({{ s.timezone }}, Cairo in brackets)</legend>
                  @for (l of subLessons(); track l.id) {
                    <label class="lesson" [class.off]="l.teacher.id === teacherId()">
                      <input
                        type="checkbox"
                        [checked]="picked().has(l.id)"
                        [disabled]="l.teacher.id === teacherId()"
                        (change)="toggle(l.id)"
                      />
                      <span>{{ when(l.startsAt, s.timezone) }}</span>
                      <span class="muted"
                        >({{ cairo(l.startsAt) }} Cairo){{
                          l.teacher.id !== current()?.teacher?.id ? ' · with ' + l.teacher.name : ''
                        }}</span
                      >
                    </label>
                  } @empty {
                    <p class="muted small">
                      {{ upcoming.isLoading() ? 'Loading…' : 'No upcoming lessons.' }}
                    </p>
                  }
                </fieldset>
              }
            </section>

            <section class="card step" aria-labelledby="tr-to">
              <h2 id="tr-to"><span class="num">2</span> To which teacher?</h2>
              @if (chosen(); as t) {
                <div class="picked">
                  <div>
                    <strong>{{ t.name }}</strong>
                    <span class="muted"> · {{ tier(t.level) }}</span>
                    @if (t.fit) {
                      <div class="small" [class.ok]="t.ok" [class.warn]="!t.ok">{{ t.fit }}</div>
                    }
                  </div>
                  <button type="button" class="btn small" (click)="teacherId.set('')">
                    Change
                  </button>
                </div>
              } @else {
                <div class="search">
                  <label for="tr-q" class="sr-only">Find a teacher</label>
                  <input
                    id="tr-q"
                    type="search"
                    role="combobox"
                    aria-controls="tr-list"
                    [attr.aria-expanded]="true"
                    autocomplete="off"
                    placeholder="Search teachers by name…"
                    [ngModel]="query()"
                    (ngModelChange)="query.set($event)"
                  />
                  <ul id="tr-list" role="listbox" aria-label="Teachers">
                    @for (t of matches(); track t.id) {
                      <li
                        role="option"
                        tabindex="0"
                        [attr.aria-selected]="false"
                        (click)="teacherId.set(t.id)"
                        (keydown.enter)="teacherId.set(t.id)"
                      >
                        <span
                          ><strong>{{ t.name }}</strong
                          ><span class="muted"> · {{ tier(t.level) }}</span></span
                        >
                        @if (t.fit) {
                          <span class="small" [class.ok]="t.ok" [class.warn]="!t.ok">{{
                            t.fit
                          }}</span>
                        }
                      </li>
                    } @empty {
                      <li class="muted none" role="presentation">
                        {{
                          query()
                            ? 'No teacher by that name.'
                            : 'No other teacher teaches this curriculum.'
                        }}
                      </li>
                    }
                  </ul>
                  @if (more()) {
                    <p class="muted small">{{ more() }} more: type a name to narrow down.</p>
                  }
                </div>
              }
            </section>

            <div class="actions">
              <button
                type="button"
                class="btn primary"
                [disabled]="busy() || !ready()"
                (click)="go(false)"
              >
                {{ buttonText() }}
              </button>
              @if (canOverride()) {
                <button type="button" class="btn" [disabled]="busy()" (click)="go(true)">
                  Transfer anyway
                </button>
              }
              <a class="btn" [routerLink]="['/admin/students', s.id]">Cancel</a>
            </div>
          </div>
        }
      } @else {
        <p class="empty">{{ student.error() ? 'Student not found.' : 'Loading…' }}</p>
      }
    </div>
  `,
  styles: `
    .steps {
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-width: 760px;
    }
    .step {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .step h2 {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 16px;
      color: var(--ink);
    }
    .num {
      display: inline-grid;
      place-items: center;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: var(--primary-tint);
      color: var(--primary);
      font-size: 13px;
    }
    .choices {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    @media (max-width: 640px) {
      .choices {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .choice {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 14px 16px;
      border: 1px solid var(--border-strong);
      border-radius: 12px;
      background: var(--surface);
      font: inherit;
      text-align: start;
      cursor: pointer;
    }
    .choice span {
      font-size: 13px;
      color: var(--muted);
      line-height: 1.45;
    }
    .choice[aria-checked='true'] {
      border: 2px solid var(--primary);
      padding: 13px 15px;
      background: var(--primary-tint);
    }
    .lessons {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 14px;
      margin: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 6px 16px;
      max-height: 280px;
      overflow: auto;
    }
    .lessons legend {
      font-weight: 600;
      padding: 0 4px;
    }
    .lesson.off {
      opacity: 0.5;
    }
    .lesson {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 32px;
      cursor: pointer;
    }
    .search input {
      width: 100%;
      min-height: 44px;
      padding: 0 12px;
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      font: inherit;
    }
    .search ul {
      list-style: none;
      margin: 8px 0 0;
      padding: 0;
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
    }
    .search li {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      cursor: pointer;
    }
    .search li + li {
      border-top: 1px solid var(--divider);
    }
    .search li:hover,
    .search li:focus-visible {
      background: var(--primary-tint);
      outline: none;
    }
    .search li.none {
      cursor: default;
    }
    .picked {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border: 2px solid var(--primary);
      border-radius: 12px;
      background: var(--primary-tint);
    }
    .small {
      font-size: 13px;
      margin: 0;
    }
    .ok {
      color: var(--primary);
    }
    .warn {
      color: var(--warn);
    }
    .narrow-field {
      max-width: 420px;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .notice {
      margin: 0;
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
export class AdminTransfer {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  readonly id = input.required<string>();
  /** ?subscription=<id>: which of their lessons */
  readonly subscription = input<string | undefined>(undefined);
  /** ?lesson=<id>: start with just that lesson picked */
  readonly lesson = input<string | undefined>(undefined);

  protected readonly student = httpResource<StudentDetail>(() => `/api/students/${this.id()}`);
  private readonly teachers = httpResource<TeacherRow[]>(() => '/api/teachers', {
    defaultValue: [],
  });
  protected readonly subs = computed(() =>
    (this.student.value()?.subscriptions ?? []).filter((x) => x.status === 'ACTIVE'),
  );
  protected readonly subId = linkedSignal(() => {
    const list = this.subs();
    return list.find((x) => x.id === this.subscription())?.id ?? list[0]?.id ?? '';
  });
  protected readonly current = computed(() => this.subs().find((x) => x.id === this.subId()));

  protected readonly span = signal<Span>('all');
  protected readonly picked = signal(new Set<string>());
  protected readonly teacherId = signal('');
  protected readonly query = signal('');
  protected readonly error = signal('');
  protected readonly canOverride = signal(false);
  protected readonly busy = signal(false);
  protected readonly tier = tierLabel;
  protected readonly when = dayTime;

  /** How each teacher of the curriculum fits all the upcoming lessons. */
  private readonly options = httpResource<TransferOption[]>(
    () => (this.subId() ? `/api/subscriptions/${this.subId()}/transfer-options` : undefined),
    { defaultValue: [] },
  );
  protected readonly upcoming = httpResource<Lesson[]>(
    () =>
      this.subId() && this.span() === 'some'
        ? {
            url: '/api/lessons',
            params: {
              studentId: this.id(),
              from: new Date().toISOString(),
              status: 'SCHEDULED',
              order: 'asc',
              limit: 60,
            },
          }
        : undefined,
    { defaultValue: [] },
  );

  /** Upcoming lessons of these weekly lessons (not a trial or another subscription). */
  protected readonly subLessons = computed(() =>
    this.upcoming.value().filter((l) => l.subscriptionId === this.subId()),
  );

  /** Teachers to pick from, with how they fit when moving everything. */
  private readonly candidates = computed(() => {
    const current = this.current()?.teacher.id;
    const fits = new Map(this.options.value().map((o) => [o.teacherId, o]));
    // The API lists the active teachers of the curriculum.
    return this.teachers
      .value()
      .filter((t) => t.status === 'ACTIVE' && t.id !== current && fits.has(t.id))
      .map((t) => {
        const o = fits.get(t.id);
        let fit = '';
        let ok = true;
        if (o && this.span() === 'all') {
          const parts: string[] = [];
          if (o.outsideHours) parts.push(`${o.outsideHours} of ${o.lessons} outside their hours`);
          if (o.busy) parts.push(`${o.busy} clash with their lessons`);
          if (o.levelTooLow) parts.push('below the plan level');
          ok = !parts.length;
          fit = ok ? (o.lessons ? `Free for all ${o.lessons} lessons` : '') : parts.join(' · ');
        }
        return { id: t.id, name: t.fullName, level: t.level, fit, ok };
      })
      .sort((a, b) => Number(b.ok) - Number(a.ok) || a.name.localeCompare(b.name));
  });
  private readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    return q
      ? this.candidates().filter((t) => t.name.toLowerCase().includes(q))
      : this.candidates();
  });
  protected readonly matches = computed(() => this.filtered().slice(0, 6));
  protected readonly more = computed(() => Math.max(0, this.filtered().length - 6));
  protected readonly chosen = computed(() =>
    this.candidates().find((t) => t.id === this.teacherId()),
  );

  protected readonly ready = computed(
    () => !!this.teacherId() && (this.span() === 'all' || this.picked().size > 0),
  );
  protected readonly buttonText = computed(() => {
    if (this.span() === 'all') return 'Transfer for good';
    const n = this.picked().size;
    return n ? `Transfer ${n} ${n === 1 ? 'lesson' : 'lessons'}` : 'Transfer';
  });

  constructor() {
    // Lessons already with the chosen teacher can't move to them.
    effect(() => {
      const to = this.teacherId();
      const theirs = new Set(
        this.upcoming
          .value()
          .filter((l) => l.teacher.id === to)
          .map((l) => l.id),
      );
      if (theirs.size)
        untracked(() => this.picked.update((p) => new Set([...p].filter((id) => !theirs.has(id)))));
    });
    effect(() => {
      const id = this.lesson();
      if (id)
        untracked(() => {
          this.span.set('some');
          this.picked.set(new Set([id]));
        });
    });
    effect(() => {
      this.span();
      this.teacherId();
      this.subId();
      untracked(() => {
        this.error.set('');
        this.canOverride.set(false);
      });
    });
  }

  protected first(name: string) {
    return name.split(' ')[0];
  }

  protected cairo(iso: string) {
    return time(iso, ACADEMY_TZ);
  }

  protected toggle(id: string) {
    this.picked.update((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected async go(override: boolean) {
    const sub = this.current();
    const to = this.chosen();
    if (!sub || !to) return;
    this.busy.set(true);
    this.error.set('');
    try {
      let done: string;
      if (this.span() === 'all') {
        const res = await this.api.transferSubscription(sub.id, {
          teacherId: to.id,
          override: override || undefined,
        });
        done = `Transferred to ${to.name}: ${res.lessonsMoved} upcoming lessons.`;
      } else {
        // One by one; a lesson already moved drops out of the list, so a retry
        // after "Transfer anyway" only sends the ones left.
        const ids = [...this.picked()];
        for (const id of ids) {
          await this.api.transferLesson(id, { teacherId: to.id, override: override || undefined });
          this.picked.update((s) => {
            const next = new Set(s);
            next.delete(id);
            return next;
          });
        }
        done = `${ids.length} ${ids.length === 1 ? 'lesson' : 'lessons'} transferred to ${to.name}.`;
      }
      this.toast.success(done);
      await this.router.navigate(['/admin/students', this.id()]);
    } catch (err) {
      const e = ruleError(err);
      this.error.set(e.message);
      this.canOverride.set(e.canOverride);
      this.upcoming.reload();
    } finally {
      this.busy.set(false);
    }
  }
}
