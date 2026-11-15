import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
import { ACADEMY_TZ, time } from '../core/format';
import type { AuditEntry } from '../core/models';
import { actionLabel, fieldLabel, prettyValue, roleLabel } from './log-labels';

const PAGE = 15;

/**
 * The activity of the page it sits on: a student's or teacher's history, one
 * invoice's, or one kind of action (lessons, invoices…). Newest first, times in
 * Cairo, "Show older" for more. Only for those who may read the log.
 */
@Component({
  selector: 'app-page-log',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (allowed() && !failed()) {
      <section class="card flush log" [attr.aria-labelledby]="uid + '-title'">
        <div class="card-head">
          <h2 [id]="uid + '-title'">{{ title() }}</h2>
          <span class="muted small">Every change, newest first · Cairo time</span>
        </div>
        <ol class="entries">
          @for (e of entries(); track e.id; let i = $index) {
            @if (i === 0 || dayOf(e.at) !== dayOf(entries()[i - 1].at)) {
              <li class="day" aria-hidden="true">{{ dayOf(e.at) }}</li>
            }
            <li class="entry" [class.override]="e.override">
              <span class="time">{{ clock(e.at) }}</span>
              <div class="body">
                <span class="what">
                  <strong>{{ label(e.action) }}</strong>
                  @if (e.override) {
                    <span class="chip warn">rule set aside</span>
                  }
                </span>
                <span class="summary">{{ e.summary }}</span>
                @if (e.changes.length) {
                  <ul class="changes">
                    @for (c of e.changes; track c.field) {
                      <li>
                        <span class="muted">{{ field(c.field) }}:</span>
                        {{ pretty(c.from) }} <span aria-label="changed to">→</span>
                        <strong>{{ pretty(c.to) }}</strong>
                      </li>
                    }
                  </ul>
                }
                @if (e.note) {
                  <span class="note">{{ e.note }}</span>
                }
                <span class="by muted"
                  >by {{ e.actorName ?? 'the system' }} · {{ role(e.actorKind) }}
                  @if (showPeople()) {
                    @if (e.about?.student; as st) {
                      · <a [routerLink]="['/admin/students', st.id]">{{ st.name }}</a>
                    }
                    @if (e.about?.teacher; as te) {
                      · <a [routerLink]="['/admin/teachers', te.id]">{{ te.name }}</a>
                    }
                  }
                </span>
              </div>
            </li>
          } @empty {
            <li class="empty">{{ loading() ? 'Loading…' : 'Nothing yet.' }}</li>
          }
        </ol>
        @if (hasMore()) {
          <div class="more">
            <button type="button" class="btn small" [disabled]="loading()" (click)="older()">
              Show older
            </button>
          </div>
        }
      </section>
    }
  `,
  styles: `
    .log h2 {
      font-size: 16px;
      color: var(--ink);
    }
    .entries {
      list-style: none;
      margin: 0;
      padding: 0 20px 8px;
      max-height: 520px;
      overflow: auto;
    }
    .day {
      position: sticky;
      top: 0;
      padding: 10px 0 6px;
      background: var(--surface);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
    }
    .entry {
      display: grid;
      grid-template-columns: 72px minmax(0, 1fr);
      gap: 12px;
      padding: 10px 0;
      border-top: 1px solid var(--divider);
    }
    .entry.override {
      background: #fff8ec;
      margin: 0 -20px;
      padding: 10px 20px;
    }
    .time {
      font-size: 13px;
      font-variant-numeric: tabular-nums;
      color: var(--ink-2);
      padding-top: 1px;
    }
    .body {
      display: flex;
      flex-direction: column;
      gap: 3px;
      font-size: 14px;
      line-height: 1.45;
    }
    .what {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .summary {
      color: var(--ink-2);
    }
    .changes {
      margin: 2px 0 0;
      padding-left: 18px;
      font-size: 13px;
    }
    .note {
      font-size: 13px;
      color: var(--ink-2);
    }
    .by {
      font-size: 12px;
    }
    .empty {
      padding: 16px 0;
      color: var(--muted);
    }
    .more {
      padding: 0 20px 16px;
    }
    .small {
      font-size: 12px;
    }
  `,
})
export class PageLog {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);
  private static count = 0;
  protected readonly uid = `log-${++PageLog.count}`;

  readonly title = input('Activity');
  /** everything about this student, or this teacher */
  readonly studentId = input<string | undefined>(undefined);
  readonly teacherId = input<string | undefined>(undefined);
  /** one thing: e.g. entityType "invoice" and its id */
  readonly entityType = input<string | undefined>(undefined);
  readonly entityId = input<string | undefined>(undefined);
  /** a kind of action: "lesson.,homework." (prefixes end with a dot) */
  readonly actions = input<string | undefined>(undefined);

  protected readonly entries = signal<AuditEntry[]>([]);
  protected readonly loading = signal(false);
  protected readonly hasMore = signal(false);
  protected readonly failed = signal(false);
  private generation = 0;

  /** Admins, and staff with the activity log among their areas. */
  protected readonly allowed = computed(() => this.auth.can('logs'));
  /** Names link to people unless the page is already about one person. */
  protected readonly showPeople = computed(() => !this.studentId() && !this.teacherId());

  constructor() {
    effect(() => {
      this.studentId();
      this.teacherId();
      this.entityType();
      this.entityId();
      this.actions();
      if (this.allowed()) untracked(() => void this.load(true));
    });
    // Something was just done on the page: show its entry (after the save has landed).
    let seen = this.toasts.actionsDone();
    effect(() => {
      const n = this.toasts.actionsDone();
      if (n === seen) return;
      seen = n;
      if (untracked(this.allowed)) setTimeout(() => void this.load(true), 300);
    });
  }

  /** Called by the page after it changes something, to show the new entry. */
  reload() {
    void this.load(true);
  }

  protected older() {
    void this.load(false);
  }

  private async load(fresh: boolean) {
    const generation = fresh ? ++this.generation : this.generation;
    const params: Record<string, string> = { limit: String(PAGE) };
    const set = (k: string, v: string | undefined) => {
      if (v) params[k] = v;
    };
    set('studentId', this.studentId());
    set('teacherId', this.teacherId());
    set('entityType', this.entityType());
    set('entityId', this.entityId());
    set('actions', this.actions());
    const oldest = this.entries().at(-1);
    if (!fresh && oldest) params['to'] = oldest.at;
    this.loading.set(true);
    try {
      const page = await firstValueFrom(this.http.get<AuditEntry[]>('/api/audit-logs', { params }));
      if (generation !== this.generation) return;
      this.entries.update((list) => (fresh ? page : [...list, ...page]));
      this.hasMore.set(page.length === PAGE);
      this.failed.set(false);
    } catch {
      // No access (or the log is unreachable): the page simply has no activity box.
      if (generation === this.generation) this.failed.set(true);
    } finally {
      if (generation === this.generation) this.loading.set(false);
    }
  }

  protected dayOf(iso: string) {
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
  protected readonly label = actionLabel;
  protected readonly field = fieldLabel;
  protected readonly pretty = prettyValue;
  protected readonly role = roleLabel;
}
