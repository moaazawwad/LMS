import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { ApiService, errorMessage } from '../core/api.service';
import { dayTime } from '../core/format';
import type { ChangeRequest } from '../core/models';

const STATUS: Record<ChangeRequest['status'], { label: string; cls: string }> = {
  OPEN: { label: 'Waiting for the academy', cls: 'chip info' },
  APPROVED: { label: 'Approved', cls: 'chip ok' },
  DECLINED: { label: 'Declined', cls: 'chip danger' },
  WITHDRAWN: { label: 'Withdrawn', cls: 'chip' },
};

/** A student's or teacher's own requests, newest first, with the academy's reply. */
@Component({
  selector: 'app-my-requests',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (requests.value().length) {
      <section class="card" aria-labelledby="myreq-title">
        <h2 id="myreq-title">Your requests</h2>
        @for (r of requests.value(); track r.id) {
          <div class="req">
            <div class="row">
              <strong
                >{{ r.kind === 'CANCEL' ? 'Cancel' : 'Move' }} ·
                {{ r.lesson ? when(r.lesson.startsAt) : 'lesson' }}</strong
              >
              <span [class]="status[r.status].cls">{{ status[r.status].label }}</span>
            </div>
            @if (r.resolutionNote) {
              <p class="reply">
                <span class="muted">{{ r.resolvedBy ?? 'The academy' }}:</span>
                {{ r.resolutionNote }}
              </p>
            }
            @if (r.status === 'OPEN') {
              <button type="button" class="btn small" [disabled]="busy()" (click)="withdraw(r)">
                Withdraw
              </button>
            }
          </div>
        }
      </section>
    }
  `,
  styles: `
    .req {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
      padding: 12px 0;
      border-top: 1px solid var(--divider);
    }
    .req:first-of-type {
      border-top: 0;
      padding-top: 0;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 6px 12px;
      width: 100%;
    }
    .reply {
      margin: 0;
      font-size: 14px;
    }
  `,
})
export class MyRequests {
  private readonly api = inject(ApiService);
  /** Clock the lesson times are shown on. */
  readonly timezone = input.required<string>();
  protected readonly requests = httpResource<ChangeRequest[]>(
    () => ({ url: '/api/requests', params: { limit: 5 } }),
    { defaultValue: [] },
  );
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly status = STATUS;

  protected when(iso: string) {
    return dayTime(iso, this.timezone());
  }

  protected async withdraw(r: ChangeRequest) {
    if (!confirm('Withdraw this request?')) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.withdrawRequest(r.id);
      this.requests.reload();
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
