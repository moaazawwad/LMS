import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService, errorMessage } from '../core/api.service';
import { ACADEMY_TZ, addDays, dayTime, localDate, time } from '../core/format';
import type { CancelReason, FreeSlots, Lesson, RuleViolationError } from '../core/models';
import { DateField } from './date-field';
import { ToastService } from '../core/toast.service';

export type LessonTab = 'reschedule' | 'cancel';

/**
 * Staff dialog to move or cancel a lesson. The API checks every rule; when a
 * rule blocks the change, staff can go ahead anyway (the log says which rule).
 */
@Component({
  selector: 'app-lesson-action-dialog',
  imports: [DateField, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg (close)="closed.emit(changed)" aria-labelledby="lad-title">
      @if (lesson(); as l) {
        <div class="head">
          <h2 id="lad-title">{{ tab() === 'reschedule' ? 'Reschedule' : 'Cancel' }} a lesson</h2>
          <button type="button" class="close" (click)="dlg.close()" aria-label="Close">✕</button>
        </div>

        <div class="lesson">
          <strong>{{ l.student.name }}</strong>
          <span>{{ when(l.startsAt, l.student.timezone) }} their time</span>
          <span class="muted">{{ cairo(l.startsAt) }} Cairo · with {{ l.teacher.name }}</span>
        </div>

        <div class="tabs" role="tablist" aria-label="What to do">
          <button
            type="button"
            role="tab"
            [attr.aria-selected]="tab() === 'reschedule'"
            (click)="setTab('reschedule')"
          >
            Reschedule
          </button>
          <button
            type="button"
            role="tab"
            [attr.aria-selected]="tab() === 'cancel'"
            (click)="setTab('cancel')"
          >
            Cancel
          </button>
        </div>

        @if (tab() === 'reschedule') {
          <div class="block">
            <span class="label" id="lad-by">Who asked?</span>
            <div class="seg" role="radiogroup" aria-labelledby="lad-by">
              @for (o of askers; track o.value) {
                <button
                  type="button"
                  role="radio"
                  [attr.aria-checked]="requestedBy === o.value"
                  (click)="requestedBy = o.value"
                >
                  {{ o.label }}
                </button>
              }
            </div>
            <p class="hint">{{ askerHint() }}</p>
          </div>
          <div class="block">
            <label class="label" for="lad-date"
              >New day <span class="muted">({{ l.student.timezone }})</span></label
            >
            <app-date-field inputId="lad-date" [value]="date()" (valueChange)="pickDate($event)" />
          </div>
          <div class="block">
            <span class="label" id="lad-times">Free times with {{ l.teacher.name }}</span>
            @for (g of groups(); track g.name) {
              <div class="group">
                <span class="gname">{{ g.name }}</span>
                <div class="slots" role="group" [attr.aria-label]="g.name">
                  @for (s of g.slots; track s.startsAt) {
                    <button
                      type="button"
                      [class.on]="chosen() === s.startsAt"
                      [attr.aria-pressed]="chosen() === s.startsAt"
                      (click)="chosen.set(s.startsAt)"
                    >
                      <strong>{{ s.local }}</strong
                      ><span>{{ s.cairo }} Cairo</span>
                    </button>
                  }
                </div>
              </div>
            } @empty {
              <p class="muted none">No free time with this teacher on that day. Try another day.</p>
            }
          </div>
        } @else {
          <div class="block">
            <span class="label" id="lad-reason">Why?</span>
            <div class="seg" role="radiogroup" aria-labelledby="lad-reason">
              @for (o of reasons; track o.value) {
                <button
                  type="button"
                  role="radio"
                  [attr.aria-checked]="reason === o.value"
                  (click)="reason = o.value"
                >
                  {{ o.label }}
                </button>
              }
            </div>
            <p class="hint">{{ reasonHint() }}</p>
          </div>
          @if (reason === 'BY_TEACHER') {
            <div class="block">
              <span class="label" id="lad-remedy">The student gets</span>
              <div class="seg" role="radiogroup" aria-labelledby="lad-remedy">
                <button
                  type="button"
                  role="radio"
                  [attr.aria-checked]="remedy === 'CREDIT'"
                  (click)="remedy = 'CREDIT'"
                >
                  A credit
                </button>
                <button
                  type="button"
                  role="radio"
                  [attr.aria-checked]="remedy === 'MAKEUP'"
                  (click)="remedy = 'MAKEUP'"
                >
                  A makeup lesson
                </button>
              </div>
            </div>
          }
        }

        <div class="foot">
          @if (tab() === 'reschedule' && chosenText(); as c) {
            <span class="to">To {{ c }}</span>
          }
          @if (canOverride()) {
            <button type="button" class="btn" (click)="submit(true)" [disabled]="busy()">
              Do it anyway
            </button>
          }
          <button
            type="button"
            class="btn primary"
            [class.danger]="tab() === 'cancel'"
            (click)="submit(false)"
            [disabled]="busy() || (tab() === 'reschedule' && !chosen())"
          >
            {{ tab() === 'reschedule' ? 'Move lesson' : 'Cancel lesson' }}
          </button>
        </div>
      }
    </dialog>
  `,
  styles: `
    dialog {
      width: min(640px, calc(100% - 24px));
      max-height: calc(100vh - 40px);
      border: 0;
      border-radius: 16px;
      padding: 20px 22px;
      box-shadow: 0 20px 50px rgba(23, 33, 29, 0.25);
      text-align: start;
      color: var(--ink);
    }
    dialog::backdrop {
      background: rgba(23, 33, 29, 0.45);
    }
    dialog > * + * {
      margin-top: 16px;
    }
    .head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }
    .head h2 {
      font-size: 18px;
      color: var(--ink);
    }
    .close {
      width: 34px;
      height: 34px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      cursor: pointer;
    }
    .lesson {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 12px 14px;
      border-radius: 12px;
      background: var(--surface-muted);
      border: 1px solid var(--border);
    }
    .lesson .muted {
      font-size: 13px;
    }
    .tabs {
      display: flex;
      gap: 4px;
      padding: 4px;
      background: var(--neutral-tint);
      border-radius: 10px;
    }
    .tabs button {
      flex: 1;
      min-height: 38px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      font: inherit;
      font-weight: 500;
      cursor: pointer;
    }
    .tabs button[aria-selected='true'] {
      background: var(--surface);
      font-weight: 700;
      box-shadow: 0 1px 2px rgba(23, 33, 29, 0.12);
    }
    .block {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .label {
      font-size: 14px;
      font-weight: 600;
    }
    .hint {
      margin: 0;
      font-size: 13px;
      color: var(--muted);
    }
    .seg {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .seg button {
      min-height: 36px;
      padding: 0 14px;
      border: 1px solid var(--border-strong);
      border-radius: 999px;
      background: var(--surface);
      font: inherit;
      cursor: pointer;
    }
    .seg button[aria-checked='true'] {
      border-color: var(--primary);
      background: var(--primary-tint);
      color: var(--primary);
      font-weight: 600;
    }
    .group {
      display: grid;
      grid-template-columns: 84px minmax(0, 1fr);
      gap: 8px;
      align-items: start;
    }
    .gname {
      padding-top: 10px;
      font-size: 13px;
      color: var(--muted);
    }
    .slots {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
      gap: 6px;
    }
    .slots button {
      min-height: 48px;
      border: 1px solid var(--border-strong);
      border-radius: 10px;
      background: var(--surface);
      font: inherit;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .slots button span {
      font-size: 11px;
      color: var(--muted);
    }
    .slots button.on {
      border: 2px solid var(--primary);
      background: var(--primary-tint);
      color: var(--primary);
    }
    .none {
      margin: 0;
    }
    .foot {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      align-items: center;
      gap: 8px;
      padding-top: 14px;
      border-top: 1px solid var(--divider);
    }
    .to {
      margin-right: auto;
      font-size: 13px;
      font-weight: 600;
      color: var(--primary);
    }
    .btn.primary.danger {
      background: var(--danger);
      border-color: var(--danger);
      color: #fff;
    }
    .notice {
      margin: 0;
    }
    @media (max-width: 520px) {
      .group {
        grid-template-columns: minmax(0, 1fr);
      }
      .gname {
        padding-top: 0;
      }
    }
  `,
})
export class LessonActionDialog {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly api = inject(ApiService);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  readonly lesson = input<Lesson | null>(null);
  /** which tab opens first */
  readonly startTab = input<LessonTab>('reschedule');
  readonly closed = output<boolean>();

  protected readonly tab = signal<LessonTab>('reschedule');
  protected readonly date = signal('');
  protected readonly slots = signal<FreeSlots['slots']>([]);
  protected readonly chosen = signal<string | null>(null);
  protected readonly error = signal('');
  protected readonly canOverride = signal(false);
  protected readonly busy = signal(false);
  protected requestedBy: 'STUDENT' | 'TEACHER' | 'ADMIN' = 'STUDENT';
  protected reason: CancelReason = 'BY_STUDENT';
  protected remedy: 'CREDIT' | 'MAKEUP' = 'CREDIT';
  protected changed = false;

  protected readonly when = dayTime;
  protected cairo(iso: string) {
    return time(iso, ACADEMY_TZ);
  }

  protected readonly askers = [
    { value: 'STUDENT' as const, label: 'Student' },
    { value: 'TEACHER' as const, label: 'Teacher' },
    { value: 'ADMIN' as const, label: 'Academy' },
  ];
  protected readonly reasons = [
    { value: 'BY_STUDENT' as CancelReason, label: 'Student asked' },
    { value: 'BY_TEACHER' as CancelReason, label: "Teacher can't" },
    { value: 'BY_ADMIN' as CancelReason, label: 'Academy decision' },
    { value: 'UNPAID' as CancelReason, label: 'Unpaid invoice' },
  ];

  protected askerHint() {
    return this.requestedBy === 'STUDENT'
      ? "Counts toward the student's reschedules this cycle."
      : this.requestedBy === 'TEACHER'
        ? "Counts toward the teacher's changes this month."
        : "Doesn't count toward anyone's limit.";
  }

  protected reasonHint() {
    switch (this.reason) {
      case 'BY_STUDENT':
        return 'Late or over their quota, it counts as taken; otherwise they get a credit.';
      case 'BY_TEACHER':
        return "Counts toward the teacher's cancellations this month.";
      case 'BY_ADMIN':
        return 'The student gets a credit on the next invoice.';
      default:
        return 'No credit: the lesson was not paid for.';
    }
  }

  /** The free times of the day, split into morning, afternoon and evening. */
  protected groups() {
    const l = this.lesson();
    if (!l) return [];
    const hour = new Intl.DateTimeFormat('en-GB', {
      timeZone: l.student.timezone,
      hour: '2-digit',
      hourCycle: 'h23',
    });
    const parts = [
      { name: 'Morning', slots: [] as FreeSlots['slots'] },
      { name: 'Afternoon', slots: [] as FreeSlots['slots'] },
      { name: 'Evening', slots: [] as FreeSlots['slots'] },
    ];
    for (const s of this.slots()) {
      const h = Number(hour.format(new Date(s.startsAt)));
      parts[h < 12 ? 0 : h < 17 ? 1 : 2].slots.push(s);
    }
    return parts.filter((p) => p.slots.length);
  }

  protected chosenText() {
    const l = this.lesson();
    const at = this.chosen();
    if (!l || !at) return '';
    return `${dayTime(at, l.student.timezone)} (${time(at, ACADEMY_TZ)} Cairo)`;
  }

  constructor() {
    effect(() => {
      const l = this.lesson();
      if (!l) return;
      this.changed = false;
      this.error.set('');
      this.canOverride.set(false);
      this.tab.set(untracked(this.startTab));
      this.chosen.set(null);
      void this.pickDate(addDays(localDate(l.startsAt, l.student.timezone), 1));
      this.dlg().nativeElement.showModal();
    });
  }

  protected setTab(tab: LessonTab) {
    this.tab.set(tab);
    this.error.set('');
    this.canOverride.set(false);
  }

  protected async pickDate(date: string) {
    const l = this.lesson();
    if (!l || !date) return;
    this.date.set(date);
    this.chosen.set(null);
    try {
      const res = await firstValueFrom(
        this.http.get<FreeSlots>(`/api/lessons/${l.id}/free-slots`, { params: { date } }),
      );
      this.slots.set(res.slots);
    } catch (err) {
      this.slots.set([]);
      this.toast.error(errorMessage(err));
    }
  }

  protected async submit(override: boolean) {
    const l = this.lesson();
    if (!l) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const extra = { override: override || undefined };
      if (this.tab() === 'reschedule') {
        await this.api.rescheduleLesson(l.id, {
          startsAt: this.chosen()!,
          requestedBy: this.requestedBy,
          ...extra,
        });
      } else {
        await this.api.cancelLesson(l.id, {
          reason: this.reason,
          teacherRemedy: this.reason === 'BY_TEACHER' ? this.remedy : undefined,
          ...extra,
        });
      }
      this.changed = true;
      this.dlg().nativeElement.close();
    } catch (err) {
      this.error.set(errorMessage(err));
      const body =
        err instanceof HttpErrorResponse ? (err.error as Partial<RuleViolationError>) : null;
      this.canOverride.set(!!body?.canOverride);
    } finally {
      this.busy.set(false);
    }
  }
}
