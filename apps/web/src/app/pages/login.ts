import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { BRAND } from '../shared/brand';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <form class="card" (ngSubmit)="submit()">
        <img
          class="logo"
          src="brand/brightverse-logo.svg"
          [alt]="brand.name"
          width="214"
          height="54"
        />
        <h1>Sign in</h1>
        <div class="field">
          <label for="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autocomplete="username"
            required
            [(ngModel)]="email"
          />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autocomplete="current-password"
            required
            [(ngModel)]="password"
          />
        </div>
        @if (error()) {
          <p class="notice danger" role="alert">{{ error() }}</p>
        }
        <button class="btn primary" type="submit" [disabled]="busy()">
          {{ busy() ? 'Signing in…' : 'Sign in' }}
        </button>
        <a routerLink="/forgot-password" class="forgot">Forgot your password?</a>
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
      max-width: 380px;
      gap: 16px;
      padding: 28px;
    }
    .wrap {
      background:
        radial-gradient(
          ellipse 70% 55% at 50% 0%,
          rgb(242 181 58 / 0.16),
          rgb(242 181 58 / 0.06) 45%,
          rgb(242 181 58 / 0) 100%
        ),
        var(--ground);
    }
    .logo {
      display: block;
      height: 54px;
      width: auto;
      margin-bottom: 4px;
    }
    .notice {
      margin: 0;
    }
    .forgot {
      font-size: 13px;
      align-self: center;
    }
  `,
})
export class Login {
  protected readonly brand = BRAND;
  private readonly auth = inject(AuthService);
  protected email = '';
  protected password = '';
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  async submit() {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.login(this.email, this.password);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
