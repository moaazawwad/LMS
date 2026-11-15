import { HttpClient, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, linkedSignal, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ToastService } from '../../core/toast.service';

/** Admin: how families pay, shown on every unpaid invoice and in the invoice email. */
@Component({
  selector: 'app-payment-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card" aria-labelledby="pay-set-title">
      <h2 id="pay-set-title">How families pay</h2>
      <p class="muted small">
        Shown on every unpaid invoice and in the new-invoice email. For example the bank account,
        the InstaPay number or a payment link, and what to write as the reference.
      </p>
      <div class="field">
        <label for="pay-text">Payment instructions</label>
        <textarea
          id="pay-text"
          rows="5"
          maxlength="2000"
          [disabled]="saved.isLoading()"
          [value]="text()"
          (input)="text.set($any($event.target).value)"
          placeholder="Bank transfer to: …&#10;InstaPay: …&#10;Write the invoice number as the reference."
        ></textarea>
      </div>
      <div>
        <button
          type="button"
          class="btn primary"
          [disabled]="busy() || text().trim() === (saved.value()?.paymentInstructions ?? '')"
          (click)="save()"
        >
          Save
        </button>
      </div>
    </section>
  `,
  styles: `
    h2,
    p {
      margin: 0;
    }
    .small {
      font-size: 13px;
    }
    textarea {
      width: 100%;
      resize: vertical;
      font: inherit;
    }
    .notice {
      margin: 0;
    }
  `,
})
export class PaymentSettings {
  private readonly http = inject(HttpClient);
  protected readonly saved = httpResource<{ paymentInstructions: string | null }>(
    () => '/api/academy-settings',
  );
  protected readonly text = linkedSignal(() => this.saved.value()?.paymentInstructions ?? '');
  protected readonly busy = signal(false);
  private readonly toast = inject(ToastService);

  protected async save() {
    this.busy.set(true);
    try {
      const res = await firstValueFrom(
        this.http.put<{ paymentInstructions: string | null }>('/api/academy-settings', {
          paymentInstructions: this.text(),
        }),
      );
      this.saved.set(res);
      this.toast.success(
        res.paymentInstructions ? 'Saved. Unpaid invoices show it now.' : 'Removed from invoices.',
      );
    } catch {
      // the message at the top says why
    } finally {
      this.busy.set(false);
    }
  }
}
