import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { ApiService, errorMessage } from '../core/api.service';

/** "Turn off sign-in" / "Turn on sign-in" for a student or teacher account. */
@Component({
  selector: 'app-sign-in-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="btn" [disabled]="busy()" (click)="toggle()">
      {{ active() ? 'Turn off sign-in' : 'Turn on sign-in' }}
    </button>
    @if (error()) {
      <span class="err" role="alert">{{ error() }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-direction: column;
      gap: 4px;
    }
    .err {
      color: var(--danger);
      font-size: 13px;
      max-width: 240px;
    }
  `,
})
export class SignInToggle {
  private readonly api = inject(ApiService);
  readonly userId = input.required<string>();
  readonly name = input.required<string>();
  readonly active = input.required<boolean>();
  readonly changed = output<boolean>();
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected async toggle() {
    const next = !this.active();
    if (
      !next &&
      !confirm(
        `Turn off sign-in for ${this.name()}? They are signed out within a few seconds. Lessons and history stay.`,
      )
    )
      return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.setSignIn(this.userId(), next);
      this.changed.emit(next);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
