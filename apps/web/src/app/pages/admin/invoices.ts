import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { money } from '../../core/format';
import { type Invoice, type InvoiceSummary, PAYMENT_METHOD_LABEL } from '../../core/models';
import { DateField } from '../../shared/date-field';
import { PageLog } from '../../shared/page-log';
import { PayInvoiceDialog, type PayTarget } from '../../shared/pay-invoice-dialog';

const STATUS_LABEL: Record<Invoice['status'], string> = { OPEN: 'due', PAID: 'paid', VOID: 'void' };

@Component({
  selector: 'app-admin-invoices',
  imports: [PageLog, DateField, RouterLink, PayInvoiceDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <h1>Invoices</h1>
          <p>
            28-day cycles, paid in advance. Lessons cancelled within quota come off the next
            invoice.
          </p>
        </div>
      </header>
      <section class="stats" aria-label="All invoices">
        <div class="stat">
          <span>Due</span>
          <span class="n" [style.color]="summary.value()?.open?.count ? 'var(--danger)' : null">{{
            summary.value()?.open?.count ?? '…'
          }}</span>
          @if (dueTotal()) {
            <small class="muted">{{ dueTotal() }} to collect</small>
          }
        </div>
        <div class="stat">
          <span>Paid</span><span>{{ summary.value()?.paid?.count ?? '…' }}</span>
        </div>
        <div class="stat">
          <span>Void</span><span>{{ summary.value()?.void?.count ?? '…' }}</span>
        </div>
      </section>

      <div class="filters" role="search" aria-label="Filter invoices">
        <div class="field grow">
          <label for="inv-q">Search</label>
          <input
            id="inv-q"
            type="search"
            placeholder="Student name, email or invoice number"
            [value]="typed()"
            (input)="search($any($event.target).value)"
          />
        </div>
        <div class="field">
          <label for="inv-status">Status</label>
          <select
            id="inv-status"
            [value]="status()"
            (change)="status.set($any($event.target).value)"
          >
            <option value="">Any</option>
            <option value="OPEN">Due</option>
            <option value="PAID">Paid</option>
            <option value="VOID">Void</option>
          </select>
        </div>
        <div class="field">
          <label for="inv-from">Issued from</label>
          <app-date-field
            inputId="inv-from"
            [clearable]="true"
            placeholder="Any day"
            [max]="issuedTo()"
            [(value)]="issuedFrom"
          />
        </div>
        <div class="field">
          <label for="inv-to">Issued to</label>
          <app-date-field
            inputId="inv-to"
            [clearable]="true"
            placeholder="Any day"
            [min]="issuedFrom()"
            [(value)]="issuedTo"
          />
        </div>
        @if (filtering()) {
          <button type="button" class="btn clear" (click)="clear()">Clear</button>
        }
      </div>
      <p class="muted small count" role="status">{{ countText() }}</p>

      <section class="card flush">
        <div class="table-wrap">
          <table class="data" style="min-width: 900px" aria-label="Invoices">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Student</th>
                <th>Cycle</th>
                <th class="r">Lessons</th>
                <th class="r">Extra</th>
                <th class="r">Credits</th>
                <th class="r">Billed</th>
                <th class="r">Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              @for (i of invoices.value(); track i.id) {
                <tr [class.off]="i.status === 'VOID'">
                  <td class="num">
                    <a [routerLink]="[i.id]"
                      ><strong>{{ i.number }}</strong></a
                    >
                    @if (i.replacesId) {
                      <span class="sub">new copy</span>
                    }
                  </td>
                  <td>
                    <a [routerLink]="['/admin/students', i.studentId]">{{ i.studentName }}</a>
                  </td>
                  <td class="num">{{ i.cycleStart }} – {{ i.cycleEnd }}</td>
                  <td class="r num">{{ i.lessonsCount }}</td>
                  <td class="r num">{{ i.extraCount ? '+' + i.extraCount : 0 }}</td>
                  <td class="r num">{{ i.creditsCount ? '−' + i.creditsCount : 0 }}</td>
                  <td class="r num">
                    <strong>{{ i.billedLessons }}</strong>
                  </td>
                  <td class="r num">{{ money(i.totalCents, i.currency) }}</td>
                  <td>
                    @if (i.status === 'OPEN') {
                      <button
                        type="button"
                        class="btn small primary"
                        (click)="paying.set(target(i))"
                        [attr.aria-label]="'Mark ' + i.number + ' paid'"
                      >
                        Mark paid
                      </button>
                      @if (i.onHold) {
                        <span class="chip danger">Lessons on hold</span>
                      } @else if (i.overdue) {
                        <span class="chip warn">Overdue</span>
                      }
                    } @else {
                      <span class="chip" [class.ok]="i.status === 'PAID'">{{
                        label[i.status]
                      }}</span>
                      @if (i.status === 'PAID' && i.paymentMethod) {
                        <span class="sub">{{ methodLabel[i.paymentMethod] }}</span>
                      }
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="9" class="empty">
                    {{
                      invoices.isLoading()
                        ? 'Loading…'
                        : filtering()
                          ? 'No invoices match.'
                          : 'No invoices yet.'
                    }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
      <app-pay-invoice-dialog [invoice]="paying()" (closed)="paying.set(null)" (done)="paid()" />
      <app-page-log
        title="Activity on invoices"
        actions="invoice.,cycle.,settings.,subscription.hold,subscription.resume"
      />
    </div>
  `,
  styles: `
    .r {
      text-align: right;
    }
    .stat .n {
      font-size: 30px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .stat small {
      font-size: 13px;
    }
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: flex-end;
    }
    .filters .field {
      min-width: 150px;
    }
    .filters .grow {
      flex: 1 1 260px;
    }
    .count {
      margin: -12px 0 0;
    }
    tr.off td {
      color: var(--muted);
    }
    .sub {
      display: block;
      font-size: 12px;
      color: var(--muted);
    }
    .export {
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: 760px;
    }
    .export h2,
    .export p {
      margin: 0;
    }
    .small {
      font-size: 13px;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 10px;
    }
  `,
})
export class AdminInvoices {
  protected readonly label = STATUS_LABEL;

  /** What is typed; the search runs a moment after typing stops. */
  protected readonly typed = signal('');
  private readonly query = signal('');
  protected readonly status = signal('');
  protected readonly issuedFrom = signal('');
  protected readonly issuedTo = signal('');
  private timer: ReturnType<typeof setTimeout> | undefined;
  protected readonly badRange = computed(
    () => !!this.issuedFrom() && !!this.issuedTo() && this.issuedTo() < this.issuedFrom(),
  );

  protected readonly invoices = httpResource<Invoice[]>(
    () => {
      if (this.badRange()) return undefined;
      const params: Record<string, string> = {};
      if (this.query().trim()) params['q'] = this.query().trim();
      if (this.status()) params['status'] = this.status();
      if (this.issuedFrom()) params['from'] = this.issuedFrom();
      if (this.issuedTo()) params['to'] = this.issuedTo();
      return { url: '/api/invoices', params };
    },
    { defaultValue: [] },
  );
  protected readonly summary = httpResource<InvoiceSummary>(() => '/api/invoices/summary');

  protected readonly filtering = computed(
    () => !!(this.query().trim() || this.status() || this.issuedFrom() || this.issuedTo()),
  );
  protected readonly dueTotal = computed(() =>
    (this.summary.value()?.open.totals ?? [])
      .filter((t) => t.cents > 0)
      .map((t) => money(t.cents, t.currency))
      .join(' + '),
  );
  protected readonly countText = computed(() => {
    if (this.badRange()) return 'The "Issued to" day is before the "Issued from" day.';
    if (this.invoices.isLoading()) return 'Loading…';
    const n = this.invoices.value().length;
    const limit = this.summary.value()?.listLimit ?? 200;
    if (n >= limit) return `Showing the newest ${limit}. Search or filter to find older ones.`;
    return `${n} invoice${n === 1 ? '' : 's'}${this.filtering() ? ' match' : ''}`;
  });

  protected readonly money = money;
  /** this month so far, by default */

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  protected search(text: string) {
    this.typed.set(text);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.query.set(text), 300);
  }

  protected clear() {
    clearTimeout(this.timer);
    this.typed.set('');
    this.query.set('');
    this.status.set('');
    this.issuedFrom.set('');
    this.issuedTo.set('');
  }

  /** The invoice whose payment is being recorded. */
  protected readonly paying = signal<PayTarget | null>(null);
  protected readonly methodLabel = PAYMENT_METHOD_LABEL;

  protected target(i: Invoice): PayTarget {
    return {
      id: i.id,
      number: i.number,
      totalCents: i.totalCents,
      currency: i.currency,
      studentName: i.studentName,
      onHold: i.onHold,
    };
  }

  protected paid() {
    this.invoices.reload();
    this.summary.reload();
  }
}
