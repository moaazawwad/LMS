import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../core/api.service';
import { BRAND } from '../shared/brand';

/** "Forgot your password?": ask for an emailed link. */
@Component({
  selector: 'app-forgot-password',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <form class="card" (ngSubmit)="send()">
        <img
          class="logo"
          src="brand/brightverse-logo.svg"
          [alt]="brand.name"
          width="214"
          height="54"
        />
        <h1>Forgot your password?</h1>
        @if (!sent()) {
          <p class="muted">
            Type the email you sign in with. We'll send you a link to choose a new password.
          </p>
          <div class="field">
            <label for="fp-email">Email</label>
            <input
              id="fp-email"
              name="email"
              type="email"
              autocomplete="username"
              required
              [(ngModel)]="email"
            />
          </div>
          @if (error()) {
            <p class="notice danger" role="alert">{{ error() }}</p>
          }
          <button class="btn primary" type="submit" [disabled]="busy()">
            {{ busy() ? 'Sending…' : 'Send me a link' }}
          </button>
        } @else {
          <p class="notice ok" role="status">
            <span
              >If there is an account for <strong>{{ email }}</strong
              >, a link is on its way. It works for one hour. Check spam too.</span
            >
          </p>
          <p class="muted small">No email? Ask the academy to set a new password for you.</p>
        }
        <a routerLink="/login" class="small">Back to sign in</a>
      </form>
    </div>
  `,
  styles: `
    .wrap {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
    }
    form {
      width: 100%;
      max-width: 400px;
      gap: 16px;
      padding: 28px;
    }
    .logo {
      display: block;
      height: 54px;
      width: auto;
    }
    h1 {
      font-size: 24px;
    }
    p {
      margin: 0;
    }
    .small {
      font-size: 13px;
    }
  `,
})
export class ForgotPassword {
  private readonly http = inject(HttpClient);
  protected readonly brand = BRAND;
  protected email = '';
  protected readonly busy = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal('');

  async send() {
    if (!this.email.trim()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await firstValueFrom(
        this.http.post('/api/auth/forgot-password', { email: this.email.trim() }),
      );
      this.sent.set(true);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}

/** The page the emailed link opens: choose a new password. */
@Component({
  selector: 'app-reset-password',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <form class="card" (ngSubmit)="save()">
        <img
          class="logo"
          src="brand/brightverse-logo.svg"
          [alt]="brand.name"
          width="214"
          height="54"
        />
        <h1>Choose a new password</h1>
        @if (!token()) {
          <p class="notice danger" role="alert">
            This link is not complete. Open it again from the email, or ask for a new one.
          </p>
          <a routerLink="/forgot-password">Ask for a new link</a>
        } @else if (!done()) {
          <div class="field">
            <label for="rp-new">New password (8+ characters)</label>
            <input
              id="rp-new"
              name="password"
              type="password"
              autocomplete="new-password"
              required
              minlength="8"
              [(ngModel)]="password"
            />
          </div>
          <div class="field">
            <label for="rp-again">The same password again</label>
            <input
              id="rp-again"
              name="again"
              type="password"
              autocomplete="new-password"
              required
              [(ngModel)]="again"
            />
          </div>
          @if (error()) {
            <p class="notice danger" role="alert">{{ error() }}</p>
          }
          <button class="btn primary" type="submit" [disabled]="busy()">
            {{ busy() ? 'Saving…' : 'Save password' }}
          </button>
          @if (expired()) {
            <a routerLink="/forgot-password">Ask for a new link</a>
          }
        } @else {
          <p class="notice ok" role="status">Your new password is set.</p>
          <a class="btn primary" routerLink="/login">Sign in</a>
        }
      </form>
    </div>
  `,
  styles: `
    .wrap {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
    }
    form {
      width: 100%;
      max-width: 400px;
      gap: 16px;
      padding: 28px;
    }
    .logo {
      display: block;
      height: 54px;
      width: auto;
    }
    h1 {
      font-size: 24px;
    }
    p {
      margin: 0;
    }
  `,
})
export class ResetPassword {
  private readonly http = inject(HttpClient);
  protected readonly brand = BRAND;
  /** ?token= from the emailed link */
  readonly tokenParam = input<string | undefined>(undefined, { alias: 'token' });
  protected readonly token = computed(() => this.tokenParam() ?? '');
  protected password = '';
  protected again = '';
  protected readonly busy = signal(false);
  protected readonly done = signal(false);
  protected readonly error = signal('');
  protected readonly expired = signal(false);

  async save() {
    this.error.set('');
    if (this.password.length < 8) {
      this.error.set('Use at least 8 characters.');
      return;
    }
    if (this.password !== this.again) {
      this.error.set('The two passwords are not the same.');
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.http.post('/api/auth/reset-password', {
          token: this.token(),
          password: this.password,
        }),
      );
      this.done.set(true);
    } catch (err) {
      const msg = errorMessage(err);
      this.error.set(msg);
      this.expired.set(msg.includes('expired'));
    } finally {
      this.busy.set(false);
    }
  }
}
