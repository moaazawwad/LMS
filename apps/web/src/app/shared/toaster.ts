import {
  ChangeDetectionStrategy,
  Component,
  effect,
  type ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ToastService } from '../core/toast.service';

/** The messages at the top of the screen: "Done" in green, "Not done" in red. */
@Component({
  selector: 'app-toaster',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #stack class="stack" popover="manual" aria-live="polite">
      @for (t of toasts.toasts(); track t.id) {
        <div
          class="toast"
          [class.error]="t.kind === 'error'"
          [attr.role]="t.kind === 'error' ? 'alert' : 'status'"
          [attr.data-testid]="'toast-' + t.kind"
          (mouseenter)="toasts.hold(t.id)"
          (mouseleave)="toasts.release(t.id)"
          (focusin)="toasts.hold(t.id)"
          (focusout)="toasts.release(t.id)"
        >
          <span class="icon" aria-hidden="true">{{ t.kind === 'error' ? '!' : '✓' }}</span>
          <div class="body">
            <strong>{{ t.kind === 'error' ? 'Not done' : 'Done' }}</strong>
            <span class="text">{{ t.text }}</span>
            @if (t.link; as l) {
              <a
                [routerLink]="l.url"
                [queryParams]="l.queryParams ?? null"
                (click)="toasts.dismiss(t.id)"
                >{{ l.label }}</a
              >
            }
          </div>
          <button
            type="button"
            class="close"
            aria-label="Close message"
            (click)="toasts.dismiss(t.id)"
          >
            ✕
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .stack {
      position: fixed;
      inset: auto;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      overflow: visible;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 1000;
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: min(440px, calc(100% - 24px));
      pointer-events: none;
    }
    .toast {
      pointer-events: auto;
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr) 28px;
      gap: 10px;
      align-items: start;
      padding: 12px 12px 12px 14px;
      border-radius: 12px;
      background: var(--surface, #fff);
      border: 1px solid var(--border);
      border-left: 4px solid var(--primary);
      box-shadow: 0 10px 30px rgba(23, 33, 29, 0.18);
      animation: drop 160ms ease-out;
    }
    .toast.error {
      border-left-color: var(--danger);
    }
    .icon {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--primary);
      color: #fff;
      font-weight: 700;
      font-size: 14px;
    }
    .error .icon {
      background: var(--danger);
    }
    .body {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding-top: 3px;
      line-height: 1.45;
    }
    .body strong {
      font-size: 14px;
    }
    .text {
      font-size: 14px;
      color: var(--ink-2);
    }
    .body a {
      margin-top: 4px;
      font-weight: 600;
      font-size: 14px;
    }
    .close {
      width: 28px;
      height: 28px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
    }
    .close:hover {
      background: var(--neutral-tint);
    }
    @keyframes drop {
      from {
        opacity: 0;
        transform: translateY(-8px);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .toast {
        animation: none;
      }
    }
  `,
})
export class Toaster {
  protected readonly toasts = inject(ToastService);
  private readonly stack = viewChild.required<ElementRef<HTMLElement>>('stack');

  constructor() {
    // Shown as a popover, so it sits above an open dialog too: each new message
    // shows it again to bring it to the front.
    let shown = 0;
    effect(() => {
      const count = this.toasts.toasts().length;
      const el = this.stack().nativeElement;
      if (typeof el.showPopover !== 'function') return;
      const open = el.matches(':popover-open');
      if (!count) {
        if (open) el.hidePopover();
      } else if (!open || count > shown) {
        if (open) el.hidePopover();
        el.showPopover();
      }
      shown = count;
    });
  }
}
