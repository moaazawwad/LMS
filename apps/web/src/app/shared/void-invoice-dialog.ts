import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ApiService, errorMessage } from '../core/api.service';
import { money } from '../core/format';
import type { InvoiceDetail } from '../core/models';
import { ToastService } from '../core/toast.service';

/**
 * Admin voids an invoice: a reason is required, and by default a new invoice
 * is issued for the same cycle (plan price today, open credits and extra
 * lessons on it).
 */
@Component({
  selector: 'app-void-invoice-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg (close)="closed.emit()" aria-labelledby="vi-title">
      @if (invoice(); as inv) {
        <form (submit)="$event.preventDefault(); save(inv)">
          <h2 id="vi-title">Void {{ inv.number }}</h2>
          <p class="muted">
            {{ inv.student.name }} · cycle {{ inv.cycle.index }} ·
            {{ money(inv.totalCents, inv.currency) }}. The invoice stays on record marked void.
            Credits and extra lessons on it go back to waiting.
          </p>
          @if (inv.status === 'PAID') {
            <p class="notice warn" role="note">
              This invoice is marked paid. Voiding it does not send money back; refund the family
              yourself if needed.
            </p>
          }
          <div class="field">
            <label for="vi-reason"
              >Why? <span class="muted">(kept on the invoice and in the activity log)</span></label
            >
            <textarea
              id="vi-reason"
              rows="3"
              required
              maxlength="500"
              [value]="reason()"
              (input)="reason.set($any($event.target).value)"
            ></textarea>
          </div>
          <label class="check">
            <input
              type="checkbox"
              [checked]="reissue()"
              (change)="reissue.set($any($event.target).checked)"
            />
            <span>
              Issue a new invoice for this cycle
              <span class="muted small"
                >At the plan's price today, with the student's open credits and extra lessons.</span
              >
            </span>
          </label>
          @if (reissue() && inv.status === 'OPEN' && inv.standing.onHold) {
            <label class="check">
              <input
                type="checkbox"
                [checked]="takenOnly()"
                (change)="takenOnly.set($any($event.target).checked)"
              />
              <span>
                Bill only the {{ inv.standing.lessonsTaken }}
                {{ inv.standing.lessonsTaken === 1 ? 'lesson' : 'lessons' }} taken
                <span class="muted small"
                  >For a family that is not coming back: the new invoice covers the lessons taken
                  before the rest were stopped, and the stopped lessons stay removed.</span
                >
              </span>
            </label>
          }
          <div class="foot">
            <button type="button" class="btn" (click)="dlg.close()">Keep it</button>
            <button type="submit" class="btn danger" [disabled]="busy() || !ready()">
              {{ busy() ? 'Voiding…' : reissue() ? 'Void and issue a new one' : 'Void invoice' }}
            </button>
          </div>
        </form>
      }
    </dialog>
  `,
  styles: `
    dialog {
      width: min(500px, calc(100% - 32px));
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
    textarea {
      width: 100%;
      resize: vertical;
      font: inherit;
    }
    .check {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      cursor: pointer;
    }
    .check input {
      margin-top: 3px;
      width: 18px;
      height: 18px;
      flex: none;
    }
    .check > span {
      display: flex;
      flex-direction: column;
      gap: 2px;
      font-weight: 500;
    }
    .small {
      font-size: 13px;
      font-weight: 400;
    }
    .foot {
      display: flex;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 8px;
    }
  `,
})
export class VoidInvoiceDialog {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  /** Set to open the dialog. */
  readonly invoice = input<InvoiceDetail | null>(null);
  readonly closed = output<void>();
  /** Voided; the new invoice when one was issued. */
  readonly done = output<{ id: string; number: string } | null>();

  protected readonly reason = signal('');
  protected readonly reissue = signal(true);
  /** with a new invoice, for lessons on hold: bill the lessons taken only */
  protected readonly takenOnly = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly ready = computed(() => this.reason().trim().length >= 3);
  protected readonly money = money;

  constructor() {
    effect(() => {
      if (!this.invoice()) return;
      this.reason.set('');
      this.reissue.set(true);
      this.takenOnly.set(false);
      this.error.set('');
      this.dlg().nativeElement.showModal();
    });
  }

  protected async save(inv: InvoiceDetail) {
    if (!this.ready()) {
      this.toast.error('Say why the invoice is void (at least 3 characters).');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const billTaken =
        this.reissue() && this.takenOnly() && inv.status === 'OPEN' && inv.standing.onHold;
      const res = await this.api.voidInvoice(
        inv.id,
        this.reason().trim(),
        this.reissue(),
        billTaken ? inv.standing.lessonsTaken : undefined,
      );
      this.done.emit(
        res.replacement ? { id: res.replacement.id, number: res.replacement.number } : null,
      );
      this.dlg().nativeElement.close();
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
