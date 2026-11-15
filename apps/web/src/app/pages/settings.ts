import { HttpClient, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { EmailStatus } from './admin/email-status';
import { PaymentSettings } from './admin/payment-settings';
import { ToastService } from '../core/toast.service';

interface Me {
  fullName: string;
  email: string;
  phone: string | null;
  timezone: string;
}

/** The same page for students, teachers and staff. */
@Component({
  selector: 'app-settings',
  imports: [FormsModule, EmailStatus, PaymentSettings],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header>
        <h1>Settings</h1>
      </header>
      <div class="stack">
        <form class="card" (ngSubmit)="saveProfile()">
          <h2>Profile</h2>
          <div class="grid">
            <div class="field">
              <label for="s-name">Full name</label>
              <input
                id="s-name"
                name="fullName"
                [ngModel]="fullName()"
                (ngModelChange)="fullName.set($event)"
              />
            </div>
            <div class="field">
              <label for="s-phone">Phone</label>
              <input
                id="s-phone"
                name="phone"
                type="tel"
                [ngModel]="phone()"
                (ngModelChange)="phone.set($event)"
              />
            </div>
          </div>
          <div class="field">
            <label for="s-email"
              >Email <span class="muted">· used to sign in, set by the academy</span></label
            >
            <input id="s-email" [value]="me.value()?.email ?? ''" disabled />
          </div>
          <div class="field">
            <label for="s-tz">Time zone <span class="muted">· set by the academy</span></label>
            <input id="s-tz" [value]="me.value()?.timezone ?? ''" disabled />
          </div>
          @if (auth.user()?.role === 'STUDENT') {
            <p class="muted small">
              Your weekly lessons stay at the same time on your clock when daylight saving changes.
              Moving to a new city? Tell the academy.
            </p>
          }
          <div><button class="btn primary" type="submit">Save profile</button></div>
        </form>

        <form class="card" (ngSubmit)="changePassword()">
          <h2>Password</h2>
          <div class="grid">
            <div class="field">
              <label for="s-cur">Current password</label>
              <input
                id="s-cur"
                name="current"
                type="password"
                autocomplete="current-password"
                [ngModel]="current()"
                (ngModelChange)="current.set($event)"
              />
            </div>
            <div class="field">
              <label for="s-new">New password (8+ characters)</label>
              <input
                id="s-new"
                name="next"
                type="password"
                autocomplete="new-password"
                [ngModel]="next()"
                (ngModelChange)="next.set($event)"
              />
            </div>
          </div>
          <div><button class="btn" type="submit">Change password</button></div>
        </form>

        @if (auth.user()?.role === 'ADMIN') {
          <app-payment-settings />
          <app-email-status />
        }
      </div>
    </div>
  `,
  styles: `
    .stack {
      display: flex;
      flex-direction: column;
      gap: 20px;
      max-width: 760px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
    }
    .small {
      font-size: 13px;
      margin: 0;
    }
    .notice {
      margin: 0;
    }
    input:disabled {
      background: #f4f4f0;
      color: var(--ink-2);
    }
  `,
})
export class Settings {
  private readonly http = inject(HttpClient);
  protected readonly auth = inject(AuthService);
  protected readonly me = httpResource<Me>(() => '/api/auth/me');
  protected readonly fullName = signal('');
  protected readonly phone = signal('');
  protected readonly current = signal('');
  protected readonly next = signal('');

  constructor() {
    effect(() => {
      const me = this.me.value();
      if (!me) return;
      this.fullName.set(me.fullName);
      this.phone.set(me.phone ?? '');
    });
  }

  protected async saveProfile() {
    try {
      await firstValueFrom(
        this.http.patch('/api/auth/me', { fullName: this.fullName(), phone: this.phone() }),
      );
    } catch {
      // the message at the top says why
    }
  }

  protected async changePassword() {
    try {
      await firstValueFrom(
        this.http.post('/api/auth/password', {
          currentPassword: this.current(),
          newPassword: this.next(),
        }),
      );
      this.current.set('');
      this.next.set('');
    } catch {
      // the message at the top says why
    }
  }
}
