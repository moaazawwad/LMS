import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Stroke icons used across the dashboards (paths match the design canvas). */
const PATHS: Record<string, string> = {
  today: 'M3 5h18v16H3zM8 3v4M16 3v4M3 10h18M9 15l2 2 4-4',
  calendar: 'M3 5h18v16H3zM8 3v4M16 3v4M3 10h18M8 14h2M14 14h2M8 18h2',
  students:
    'M9 4.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 0 1 0-7zM2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.6.8 2.6 2.5 3 5.2',
  teachers: 'M2 9l10-5 10 5-10 5-10-5zM6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5',
  invoices: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5zM4 19a2 2 0 0 1 2-2h13',
  log: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  settings:
    'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M14 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0M8 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0M16 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9z',
  video: 'M3 6h13v12H3zM16 10l5-3v10l-5-3',
  logout: 'M15 12H3M7 8l-4 4 4 4M10 4h9a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-9',
  clock: 'M12 3a9 9 0 1 1 0 18a9 9 0 0 1 0-18zM12 7v5l3 2',
  check: 'M5 12l4 4 10-10',
  alert: 'M12 3l10 18H2L12 3zM12 10v5M12 18h.01',
  inbox: 'M3 13h5l1.5 3h5l1.5-3h5M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6l2.5-8z',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6l8-3zM9 12l2 2 4-4',
  chart: 'M3 21h18M6 17v-6M11 17V5M16 17v-9M21 17v-3',
  bell: 'M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9zM10 20a2.2 2.2 0 0 0 4 0',
};

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg
    [attr.width]="size()"
    [attr.height]="size()"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    [attr.stroke-width]="stroke()"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path [attr.d]="d()" />
  </svg>`,
  styles: ':host { display: inline-flex; flex: none; }',
})
export class Icon {
  readonly name = input.required<string>();
  readonly size = input(18);
  readonly stroke = input(1.8);
  protected readonly d = computed(() => PATHS[this.name()] ?? '');
}
