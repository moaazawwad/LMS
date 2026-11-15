import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ApiService } from '../../core/api.service';
import { money } from '../../core/format';
import { ruleError } from '../../core/forms';
import type { Payout, TeacherLessonsRow } from '../../core/models';

export type PayoutAction =
  | { kind: 'pay'; row: TeacherLessonsRow; month: string; monthName: string }
  | { kind: 'undo'; payout: Payout; monthName: string };

/**
 * Admin records a teacher's month as paid (the amount is frozen at today's
 * count), or undoes one recorded by mistake.
 */
@Component({
  selector: 'app-payout-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg (close)="closed.emit()" aria-labelledby="po-title">
      @if (action(); as a) {
        <form (submit)="$event.preventDefault(); save(a, false)">
          @if (a.kind === 'pay') {
            <h2 id="po-title">Pay {{ a.row.name }} for {{ a.monthName }}</h2>
            <dl class="sum">
              <div>
                <dt>Paid lessons</dt>
                <dd>{{ a.row.paid }}</dd>
              </div>
              <div>
                <dt>Hours</dt>
                <dd>{{ hours(a.row.paidMinutes) }}</dd>
              </div>
              <div>
                <dt>Rate</dt>
                <dd>{{ m(a.row.rateCents ?? 0, a.row.currency) }} an hour</dd>
              </div>
              <div class="total">
                <dt>Amount</dt>
                <dd>{{ m(a.row.payCents ?? 0, a.row.currency) }}</dd>
              </div>
            </dl>
            <p class="muted small">
              Pay the teacher the usual way (bank, cash, wallet), then record it here. The amount is
              kept as it is today, even if the month's lessons change later.
            </p>
            <div class="field">
              <label for="po-note"
                >Note <span class="muted">(optional: transfer number, how it was paid)</span></label
              >
              <input
                id="po-note"
                maxlength="500"
                [value]="note()"
                (input)="note.set($any($event.target).value)"
              />
            </div>
          } @else {
            <h2 id="po-title">Undo {{ a.payout.teacherName }}'s {{ a.monthName }} payment</h2>
            <p class="muted">
              The month shows as not paid again. Only do this when it was recorded by mistake.
            </p>
            <div class="field">
              <label for="po-why">Why?</label>
              <input
                id="po-why"
                maxlength="500"
                required
                [value]="note()"
                (input)="note.set($any($event.target).value)"
              />
            </div>
          }
          @if (canOverride()) {
            <p class="small">To pay anyway, write in the note why, then choose "Pay anyway".</p>
          }
          <div class="foot">
            <button type="button" class="btn" (click)="dlg.close()">Cancel</button>
            @if (a.kind === 'pay') {
              @if (canOverride()) {
                <button
                  type="button"
                  class="btn"
                  [disabled]="busy() || !note().trim()"
                  (click)="save(a, true)"
                >
                  Pay anyway
                </button>
              } @else {
                <button type="submit" class="btn primary" [disabled]="busy()">
                  Record as paid
                </button>
              }
            } @else {
              <button
                type="submit"
                class="btn danger"
                [disabled]="busy() || note().trim().length < 3"
              >
                Undo payment
              </button>
            }
          </div>
        </form>
      }
    </dialog>
  `,
  styles: `
    dialog {
      width: min(460px, calc(100% - 32px));
      border: 0;
      border-radius: 16px;
      padding: 22px 24px;
      box-shadow: 0 20px 50px rgba(23, 33, 29, 0.25);
    }
    dialog::backdrop {
      background: rgba(23, 33, 29, 0.45);
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    h2,
    p {
      margin: 0;
    }
    .sum {
      margin: 0;
      display: grid;
      gap: 6px;
      padding: 12px 14px;
      border-radius: 10px;
      background: var(--surface-muted);
      border: 1px solid var(--divider);
    }
    .sum div {
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }
    .sum dt {
      color: var(--muted);
    }
    .sum dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
    }
    .sum .total {
      padding-top: 6px;
      border-top: 1px solid var(--divider);
      font-weight: 700;
    }
    .small {
      font-size: 13px;
    }
    .foot {
      display: flex;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 8px;
    }
  `,
})
export class PayoutDialog {
  private readonly api = inject(ApiService);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  readonly action = input<PayoutAction | null>(null);
  readonly closed = output<void>();
  readonly done = output<string>();

  protected readonly note = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly canOverride = signal(false);

  constructor() {
    effect(() => {
      if (!this.action()) return;
      this.note.set('');
      this.error.set('');
      this.canOverride.set(false);
      this.dlg().nativeElement.showModal();
    });
  }

  protected m(cents: number, currency?: string) {
    return money(cents, currency ?? 'EGP');
  }
  protected hours(min: number) {
    return (min / 60).toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  protected async save(a: PayoutAction, override: boolean) {
    this.busy.set(true);
    this.error.set('');
    try {
      if (a.kind === 'pay') {
        await this.api.recordPayout({
          teacherId: a.row.teacherId,
          month: a.month,
          note: this.note().trim() || undefined,
          override: override || undefined,
        });
        this.done.emit(`${a.row.name}'s ${a.monthName} pay is recorded as paid.`);
      } else {
        await this.api.undoPayout(a.payout.id, this.note().trim());
        this.done.emit(`${a.payout.teacherName}'s ${a.monthName} payment was undone.`);
      }
      this.dlg().nativeElement.close();
    } catch (err) {
      const e = ruleError(err);
      this.error.set(e.message);
      this.canOverride.set(e.canOverride);
    } finally {
      this.busy.set(false);
    }
  }
}
