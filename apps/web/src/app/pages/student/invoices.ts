import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { money } from '../../core/format';
import type { Invoice } from '../../core/models';

/** A student's own invoices: what is due and what is paid. */
@Component({
  selector: 'app-student-invoices',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <h1>Invoices</h1>
          <p>
            Each invoice covers 28 days of lessons and is paid in advance. Lessons you cancel in
            time come off the next one.
          </p>
        </div>
      </header>

      @if (due().length) {
        <p class="notice warn" role="status">
          <span
            >Due now: <strong>{{ dueText() }}</strong
            >. The academy will tell you how to pay.</span
          >
        </p>
      }

      <section class="card flush">
        <div class="table-wrap">
          <table class="data" style="min-width: 620px">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Covers</th>
                <th class="r">Lessons</th>
                <th class="r">Extra</th>
                <th class="r">Credits</th>
                <th class="r">Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              @for (i of invoices.value(); track i.id) {
                <tr>
                  <td>
                    <a [routerLink]="[i.id]">{{ i.number }}</a>
                  </td>
                  <td>{{ i.cycleStart }} to {{ i.cycleEnd }}</td>
                  <td class="r">{{ i.lessonsCount }}</td>
                  <td class="r">{{ i.extraCount ? '+' + i.extraCount : '—' }}</td>
                  <td class="r">{{ i.creditsCount ? '−' + i.creditsCount : '—' }}</td>
                  <td class="r">
                    <strong>{{ m(i) }}</strong>
                  </td>
                  <td>
                    <span
                      class="chip"
                      [class.ok]="i.status === 'PAID'"
                      [class.danger]="i.status === 'OPEN'"
                      >{{ i.status === 'OPEN' ? 'due' : i.status.toLowerCase() }}</span
                    >
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="7" class="empty">
                    {{ invoices.isLoading() ? 'Loading…' : 'No invoices yet.' }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `,
  styles: `
    .r {
      text-align: right;
    }
  `,
})
export class StudentInvoices {
  protected readonly invoices = httpResource<Invoice[]>(() => '/api/invoices', {
    defaultValue: [],
  });
  protected readonly due = computed(() => this.invoices.value().filter((i) => i.status === 'OPEN'));
  protected readonly dueText = computed(() => {
    const byCurrency = new Map<string, number>();
    for (const i of this.due())
      byCurrency.set(i.currency, (byCurrency.get(i.currency) ?? 0) + i.totalCents);
    return [...byCurrency].map(([c, cents]) => money(cents, c)).join(' + ');
  });

  protected m(i: Invoice) {
    return money(i.totalCents, i.currency);
  }
}
