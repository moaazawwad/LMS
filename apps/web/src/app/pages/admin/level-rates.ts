import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { ApiService } from '../../core/api.service';
import { money, tierLabel } from '../../core/format';
import { dollarsToCents } from '../../core/forms';
import type { LevelPayRate, Tier } from '../../core/models';
import { ToastService } from '../../core/toast.service';

interface Draft {
  level: Tier;
  /** as typed; '' = no rate */
  amount: string;
  currency: string;
}

const toDraft = (rows: LevelPayRate[]): Draft[] =>
  rows.map((r) => ({
    level: r.level,
    amount: r.hourlyRateCents === null ? '' : String(r.hourlyRateCents / 100),
    currency: r.currency,
  }));

/**
 * Admin: pay per hour for each teacher level. A teacher with their own rate
 * (on their page) keeps it; everyone else gets their level's rate.
 */
@Component({
  selector: 'app-level-rates',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card">
      <div class="head">
        <h2 id="lvl-title">Pay per hour by level</h2>
        <span class="muted small"
          >Teachers without their own rate are paid their level's rate. Changes count for every
          month not marked paid yet.</span
        >
      </div>
      <div class="rows">
        @for (d of draft(); track d.level; let i = $index) {
          <div class="row field">
            <label class="lvl" [for]="'lvl-' + d.level">{{ tier(d.level) }}</label>
            <input
              [id]="'lvl-' + d.level"
              type="number"
              min="0"
              step="0.5"
              inputmode="decimal"
              placeholder="Not set"
              [disabled]="rates.isLoading()"
              [value]="d.amount"
              (input)="edit(i, { amount: $any($event.target).value })"
            />
            <select
              [attr.aria-label]="tier(d.level) + ' currency'"
              [value]="d.currency"
              [disabled]="rates.isLoading()"
              (change)="edit(i, { currency: $any($event.target).value })"
            >
              @for (c of currencies; track c) {
                <option [value]="c" [selected]="c === d.currency">{{ c }}</option>
              }
            </select>
            <span class="muted small who">{{ who(d.level) }}</span>
          </div>
        }
      </div>
      <div>
        <button
          type="button"
          class="btn primary"
          [disabled]="busy() || !changed()"
          (click)="save()"
        >
          Save rates
        </button>
      </div>
    </section>
  `,
  styles: `
    h2,
    p {
      margin: 0;
    }
    .head {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .small {
      font-size: 13px;
    }
    .rows {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .row {
      display: grid;
      grid-template-columns: 90px 130px 90px minmax(0, 1fr);
      gap: 8px;
      align-items: center;
    }
    .row input,
    .row select {
      width: 100%;
      min-width: 0;
    }
    .lvl {
      font-weight: 600;
    }
    .notice {
      margin: 0;
    }
    @media (max-width: 560px) {
      .row {
        grid-template-columns: 80px minmax(0, 1fr) 80px;
      }
      .who {
        grid-column: 1 / -1;
      }
    }
  `,
})
export class LevelRates {
  private readonly api = inject(ApiService);
  /** after a save, so the table can reload its pay */
  readonly changedRates = output<void>();
  protected readonly tier = tierLabel;
  protected readonly currencies = ['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED'];
  protected readonly rates = httpResource<LevelPayRate[]>(() => '/api/level-pay-rates', {
    defaultValue: [],
  });
  protected readonly draft = linkedSignal(() => toDraft(this.rates.value()));
  protected readonly busy = signal(false);
  private readonly toast = inject(ToastService);

  protected readonly changed = computed(
    () => JSON.stringify(this.draft()) !== JSON.stringify(toDraft(this.rates.value())),
  );

  protected edit(i: number, patch: Partial<Draft>) {
    this.draft.update((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  protected who(level: Tier) {
    const r = this.rates.value().find((x) => x.level === level);
    if (!r) return '';
    const n = r.teachers === 1 ? '1 teacher' : `${r.teachers} teachers`;
    return r.ownRate ? `${n} · ${r.ownRate} with their own rate` : n;
  }

  async save() {
    const rows = this.draft();
    if (rows.some((r) => r.amount.trim() !== '' && !(Number(r.amount) >= 0))) {
      this.toast.error('Rates must be zero or more.');
      return;
    }
    this.busy.set(true);
    try {
      const saved = await this.api.setLevelRates(
        rows.map((r) => ({
          level: r.level,
          hourlyRateCents: r.amount.trim() === '' ? null : dollarsToCents(r.amount),
          currency: r.currency,
        })),
      );
      this.rates.set(saved);
      this.toast.success(
        'Saved: ' +
          saved
            .map(
              (r) =>
                `${tierLabel(r.level)} ${r.hourlyRateCents === null ? 'not set' : money(r.hourlyRateCents, r.currency)}`,
            )
            .join(' · '),
      );
      this.changedRates.emit();
    } catch {
      // the message at the top says why
    } finally {
      this.busy.set(false);
    }
  }
}
