import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ApiService, errorMessage } from '../core/api.service';
import { generatePassword } from '../core/forms';

/** Staff set a new temporary password for someone and read it out to them. */
@Component({
  selector: 'app-reset-password-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg (close)="closed.emit()" aria-labelledby="rp-title">
      @if (person(); as p) {
        <h2 id="rp-title">New password for {{ p.name }}</h2>
        @if (!done()) {
          <p class="muted">
            A new temporary password replaces the old one straight away. Share it with them and ask
            them to change it in Settings.
          </p>
          <div class="field">
            <label for="rp-pass">Temporary password</label>
            <div class="row">
              <input
                id="rp-pass"
                [value]="password()"
                (input)="password.set($any($event.target).value)"
              />
              <button type="button" class="btn" (click)="password.set(newPassword())">
                New one
              </button>
            </div>
          </div>
          <div class="foot">
            <button type="button" class="btn" (click)="dlg.close()">Cancel</button>
            <button
              type="button"
              class="btn primary"
              [disabled]="busy() || password().length < 8"
              (click)="save(p.userId)"
            >
              Set password
            </button>
          </div>
        } @else {
          <p class="notice ok" role="status">
            <span
              >Done. The new password is <strong class="mono">{{ password() }}</strong></span
            >
          </p>
          <div class="foot">
            <button type="button" class="btn" (click)="copy()">
              {{ copied() ? 'Copied' : 'Copy' }}
            </button>
            <button type="button" class="btn primary" (click)="dlg.close()">Close</button>
          </div>
        }
      }
    </dialog>
  `,
  styles: `
    dialog {
      width: min(460px, calc(100% - 32px));
      border: 0;
      border-radius: 16px;
      padding: 22px 24px;
      box-shadow: 0 20px 50px rgba(23, 33, 29, 0.25);
    }
    dialog::backdrop {
      background: rgba(23, 33, 29, 0.45);
    }
    dialog > * + * {
      margin-top: 14px;
    }
    .row {
      display: flex;
      gap: 8px;
    }
    .row input {
      flex: 1;
      font-family: ui-monospace, monospace;
    }
    .foot {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .notice {
      margin: 0;
    }
  `,
})
export class ResetPasswordDialog {
  private readonly api = inject(ApiService);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  readonly person = input<{ userId: string; name: string } | null>(null);
  readonly closed = output<void>();
  protected readonly password = signal('');
  protected readonly done = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly copied = signal(false);
  protected readonly newPassword = generatePassword;

  constructor() {
    effect(() => {
      if (!this.person()) return;
      this.password.set(generatePassword());
      this.done.set(false);
      this.error.set('');
      this.copied.set(false);
      this.dlg().nativeElement.showModal();
    });
  }

  protected async save(userId: string) {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.resetPassword(userId, this.password());
      this.done.set(true);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async copy() {
    try {
      await navigator.clipboard.writeText(this.password());
      this.copied.set(true);
    } catch {
      this.copied.set(false);
    }
  }
}
