import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** The academy's name, in one place. */
export const BRAND = {
  name: 'Brightverse Academy',
  short: 'Brightverse',
} as const;

/**
 * The Brightverse mark: an open book with a bright star rising from it, on a
 * green tile. Decorative; the name next to it carries the meaning.
 * The same drawing is in public/brand and docs/brand.
 */
@Component({
  selector: 'app-brand-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      viewBox="0 0 64 64"
      [attr.width]="size()"
      [attr.height]="size()"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="64" height="64" rx="15" fill="var(--primary)" />
      <path
        d="M30.7 38.4C25.2 34.6 17.6 33.4 9.5 34.9V50.6C17.6 49.1 25.2 50.2 30.7 54Z"
        fill="#fff"
      />
      <path
        d="M33.3 38.4C38.8 34.6 46.4 33.4 54.5 34.9V50.6C46.4 49.1 38.8 50.2 33.3 54Z"
        fill="#fff"
      />
      <path
        d="M32 9.5l3.22 3.22h4.56v4.56L43 20.5l-3.22 3.22v4.56h-4.56L32 31.5l-3.22-3.22h-4.56v-4.56L21 20.5l3.22-3.22v-4.56h4.56Z"
        fill="var(--accent)"
      />
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
  `,
})
export class BrandMark {
  readonly size = input(34);
}
