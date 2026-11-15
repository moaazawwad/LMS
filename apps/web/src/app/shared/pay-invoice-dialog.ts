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
import { ApiService } from '../core/api.service';
import { money } from '../core/format';
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS, type PaymentMethod } from '../core/models';
import { ToastService } from '../core/toast.service';

/** What the dialog needs to know about the invoice. */
export interface PayTarget {
  id: string;
  number: string;
  totalCents: number;
  currency: string;
  studentName: string;
  /** lessons were removed because it is unpaid: paying brings them back */
  onHold?: boolean;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Staff record a payment: how it came in, its reference and the day it
 * arrived. In "unpay" mode an admin takes back a payment recorded by mistake.
 */
@Component({
  selector: 'app-pay-invoice-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg (close)="closed.emit()" aria-labelledby="pi-title">
      @if (invoice(); as inv) {
        <form (submit)="$event.preventDefault(); save(inv)">
          @if (mode() === 'pay') {
            <h2 id="pi-title">Record payment for {{ inv.number }}</h2>
            <p class="muted">
              {{ inv.studentName }} · <strong>{{ money(inv.totalCents, inv.currency) }}</strong>
            </p>
            @if (inv.onHold) {
              <p class="notice info" role="note">
                This student's lessons are on hold for this invoice. Recording the payment puts the
                lessons still ahead back on the calendar; the ones already missed come off the next
                invoice.
              </p>
            }
            <div class="field">
              <label for="pi-method">How was it paid?</label>
              <select
                id="pi-method"
                required
                [value]="method()"
                (change)="method.set($any($event.target).value)"
              >
                <option value="">Choose…</option>
                @for (m of methods; track m) {
                  <option [value]="m">{{ label[m] }}</option>
                }
              </select>
            </div>
            <div class="grid">
              <div class="field">
                <label for="pi-ref"
                  >Reference <span class="muted">(transfer or receipt number)</span></label
                >
                <input
                  id="pi-ref"
                  maxlength="120"
                  [value]="reference()"
                  (input)="reference.set($any($event.target).value)"
                />
              </div>
              <div class="field">
                <label for="pi-day">Day the money arrived</label>
                <input
                  id="pi-day"
                  type="date"
                  required
                  [max]="maxDay"
                  [value]="receivedOn()"
                  (input)="receivedOn.set($any($event.target).value)"
                />
              </div>
            </div>
            <div class="field">
              <label for="pi-note">Note <span class="muted">(staff only, optional)</span></label>
              <input
                id="pi-note"
                maxlength="500"
                [value]="note()"
                (input)="note.set($any($event.target).value)"
              />
            </div>
          } @else {
            <h2 id="pi-title">Take back the payment of {{ inv.number }}</h2>
            <p class="muted">
              {{ inv.studentName }} · {{ money(inv.totalCents, inv.currency) }}. Use this when the
              invoice was marked paid by mistake. It becomes due again, and the rules for unpaid
              invoices apply to it.
            </p>
            <div class="field">
              <label for="pi-reason"
                >Why? <span class="muted">(kept in the activity log)</span></label
              >
              <textarea
                id="pi-reason"
                rows="3"
                required
                maxlength="500"
                [value]="reason()"
                (input)="reason.set($any($event.target).value)"
              ></textarea>
            </div>
          }
          <div class="foot">
            <button type="button" class="btn" (click)="dlg.close()">Cancel</button>
            <button
              type="submit"
              class="btn"
              [class.primary]="mode() === 'pay'"
              [class.danger]="mode() === 'unpay'"
              [disabled]="busy() || !ready()"
            >
              {{ busy() ? 'Saving…' : mode() === 'pay' ? 'Record payment' : 'Take payment back' }}
            </button>
          </div>
        </form>
      }
    </dialog>
  `,
  styles: `
    dialog {
      width: min(520px, calc(100% - 32px));
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
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 14px;
    }
    select,
    input,
    textarea {
      width: 100%;
      font: inherit;
    }
    textarea {
      resize: vertical;
    }
    .foot {
      display: flex;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 8px;
    }
  `,
})
export class PayInvoiceDialog {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  /** Set to open the dialog. */
  readonly invoice = input<PayTarget | null>(null);
  readonly mode = input<'pay' | 'unpay'>('pay');
  readonly closed = output<void>();
  readonly done = output<void>();

  protected readonly methods = PAYMENT_METHODS;
  protected readonly label = PAYMENT_METHOD_LABEL;
  protected readonly money = money;
  protected readonly maxDay = today();
  protected readonly method = signal<PaymentMethod | ''>('');
  protected readonly reference = signal('');
  protected readonly receivedOn = signal(today());
  protected readonly note = signal('');
  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly ready = computed(() =>
    this.mode() === 'pay'
      ? !!this.method() && !!this.receivedOn()
      : this.reason().trim().length >= 3,
  );

  constructor() {
    effect(() => {
      if (!this.invoice()) return;
      this.method.set('');
      this.reference.set('');
      this.receivedOn.set(today());
      this.note.set('');
      this.reason.set('');
      this.dlg().nativeElement.showModal();
    });
  }

  protected async save(inv: PayTarget) {
    if (!this.ready()) {
      this.toast.error(
        this.mode() === 'pay'
          ? 'Choose how it was paid.'
          : 'Say why the payment is taken back (at least 3 characters).',
      );
      return;
    }
    this.busy.set(true);
    try {
      if (this.mode() === 'pay') {
        const res = await this.api.payInvoice(inv.id, {
          method: this.method() as PaymentMethod,
          reference: this.reference().trim() || undefined,
          receivedOn: this.receivedOn(),
          note: this.note().trim() || undefined,
        });
        if (res.resumed) {
          const r = res.resumed;
          const parts = [
            r.restored && `${r.restored} lesson${r.restored === 1 ? '' : 's'} back on the calendar`,
            r.credited &&
              `${r.credited} missed lesson${r.credited === 1 ? '' : 's'} will come off the next invoice`,
          ].filter(Boolean);
          this.toast.success(
            `${parts.join(', ') || 'No lessons to bring back'}.${r.active ? '' : ' The cycle is over: book new weekly lessons to bring the student back.'}`,
          );
        }
      } else {
        await this.api.unpayInvoice(inv.id, this.reason().trim());
      }
      this.done.emit();
      this.dlg().nativeElement.close();
    } catch {
      // The red "Not done" message says why.
    } finally {
      this.busy.set(false);
    }
  }
}
