import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { addDays, localDate } from '../core/format';

const WEEK = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "Mon, Nov 2, 2026" for "2026-11-02" ('' stays ''). */
export function longDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${date}T12:00:00Z`));
}

/** What someone typed as a date: "2026-11-02", "Nov 2, 2026", "2 Nov 2026"... or null. */
export function parseDate(text: string): string | null {
  const t = text.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d = new Date(`${t}T12:00:00Z`);
    return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t ? null : t;
  }
  const d = new Date(`${t} 12:00 UTC`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * A date field: type a date or pick it from a calendar (weeks start on
 * Saturday). The value is a plain "YYYY-MM-DD" date, '' when empty.
 */
@Component({
  selector: 'app-date-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="df" [class.open]="open()">
      <input
        [id]="inputId()"
        type="text"
        autocomplete="off"
        [value]="text()"
        [placeholder]="placeholder()"
        [disabled]="disabled()"
        [attr.aria-invalid]="bad() || null"
        (change)="typed($any($event.target).value)"
        (keydown.enter)="typed($any($event.target).value); $event.preventDefault()"
        (keydown.arrowdown)="show(); $event.preventDefault()"
        (click)="show()"
      />
      <button
        type="button"
        class="icon"
        tabindex="-1"
        [disabled]="disabled()"
        [attr.aria-label]="'Open calendar'"
        (click)="open() ? close() : show()"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <rect
            x="3.5"
            y="5"
            width="17"
            height="15"
            rx="2.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
          />
          <path
            d="M3.5 10h17M8 3v4M16 3v4"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
          />
        </svg>
      </button>
      @if (open()) {
        <div class="pop" role="dialog" aria-label="Choose a date" (keydown.escape)="close(true)">
          <div class="head">
            <button type="button" class="nav" aria-label="Previous month" (click)="step(-1)">
              ‹
            </button>
            <strong aria-live="polite">{{ monthTitle() }}</strong>
            <button type="button" class="nav" aria-label="Next month" (click)="step(1)">›</button>
          </div>
          <div class="grid" role="grid" (keydown)="move($event)">
            @for (d of week; track d) {
              <span class="dow" role="columnheader">{{ d }}</span>
            }
            @for (c of cells(); track c.date) {
              <button
                type="button"
                role="gridcell"
                class="day"
                [class.out]="!c.inMonth"
                [class.today]="c.date === today"
                [class.on]="c.date === value()"
                [disabled]="c.blocked"
                [attr.data-date]="c.date"
                [attr.aria-label]="long(c.date)"
                [attr.aria-selected]="c.date === value()"
                [tabindex]="c.date === cursor() ? 0 : -1"
                (click)="pick(c.date)"
              >
                {{ c.day }}
              </button>
            }
          </div>
          <div class="foot">
            <button type="button" class="link" [disabled]="blocked(today)" (click)="pick(today)">
              Today
            </button>
            @if (clearable() && value()) {
              <button type="button" class="link" (click)="pick('')">Clear</button>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .df {
      position: relative;
    }
    input {
      width: 100%;
      min-height: 44px;
      padding: 0 42px 0 12px;
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      font: inherit;
      font-size: 14px;
      color: var(--ink);
      background: var(--surface, #fff);
      box-sizing: border-box;
    }
    input[aria-invalid='true'] {
      border-color: var(--danger);
    }
    .icon {
      position: absolute;
      right: 4px;
      top: 50%;
      transform: translateY(-50%);
      width: 36px;
      height: 36px;
      display: grid;
      place-items: center;
      border: 0;
      background: none;
      color: var(--muted);
      cursor: pointer;
      border-radius: 6px;
    }
    .icon:hover {
      color: var(--primary);
      background: var(--primary-tint);
    }
    .pop {
      position: absolute;
      z-index: 30;
      top: calc(100% + 6px);
      left: 0;
      width: 300px;
      padding: 12px;
      background: var(--surface, #fff);
      border: 1px solid var(--border);
      border-radius: 12px;
      box-shadow: 0 12px 32px rgb(0 0 0 / 14%);
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .head strong {
      font-size: 15px;
    }
    .nav {
      width: 34px;
      height: 34px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: none;
      font-size: 18px;
      cursor: pointer;
      color: var(--ink);
    }
    .nav:hover {
      background: var(--primary-tint);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 2px;
    }
    .dow {
      text-align: center;
      font-size: 11px;
      font-weight: 700;
      color: var(--muted);
      padding: 4px 0;
      text-transform: uppercase;
    }
    .day {
      height: 36px;
      border: 0;
      border-radius: 8px;
      background: none;
      font: inherit;
      font-size: 14px;
      color: var(--ink);
      cursor: pointer;
    }
    .day:hover:not(:disabled) {
      background: var(--primary-tint);
    }
    .day.out {
      color: var(--muted);
      opacity: 0.6;
    }
    .day.today {
      font-weight: 800;
      box-shadow: inset 0 0 0 1.5px var(--accent);
    }
    .day.on {
      background: var(--primary);
      color: #fff;
      font-weight: 700;
      opacity: 1;
    }
    .day:disabled {
      opacity: 0.3;
      cursor: default;
    }
    .day:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 1px;
    }
    .foot {
      display: flex;
      justify-content: space-between;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--border);
    }
    .link {
      border: 0;
      background: none;
      color: var(--primary);
      font: inherit;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      padding: 4px 6px;
    }
    .link:disabled {
      color: var(--muted);
      cursor: default;
    }
    @media (max-width: 400px) {
      .pop {
        width: calc(100vw - 40px);
      }
    }
  `,
})
export class DateField {
  private readonly host = inject(ElementRef<HTMLElement>);
  /** "YYYY-MM-DD", '' when empty */
  readonly value = model('');
  readonly inputId = input<string>();
  readonly min = input('');
  readonly max = input('');
  readonly clearable = input(false);
  readonly disabled = input(false);
  readonly placeholder = input('Pick a date');

  protected readonly week = WEEK;
  protected readonly today = localDate(
    new Date(),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  protected readonly open = signal(false);
  protected readonly bad = signal(false);
  /** the month shown, "YYYY-MM" */
  protected readonly month = signal(this.today.slice(0, 7));
  /** the day with keyboard focus in the calendar */
  protected readonly cursor = signal(this.today);
  protected readonly text = computed(() => longDate(this.value()));
  protected readonly long = longDate;

  protected readonly monthTitle = computed(() => {
    const [y, m] = this.month().split('-').map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  });

  protected readonly cells = computed(() => {
    const first = `${this.month()}-01`;
    const dow = new Date(`${first}T12:00:00Z`).getUTCDay(); // Sun 0 ... Sat 6
    const start = addDays(first, -((dow + 1) % 7)); // back to Saturday
    return Array.from({ length: 42 }, (_, i) => {
      const date = addDays(start, i);
      return {
        date,
        day: Number(date.slice(8)),
        inMonth: date.slice(0, 7) === this.month(),
        blocked: this.blocked(date),
      };
    });
  });

  protected blocked(date: string) {
    return (!!this.min() && date < this.min()) || (!!this.max() && date > this.max());
  }

  protected show() {
    if (this.disabled()) return;
    const at = this.value() || this.today;
    this.month.set(at.slice(0, 7));
    this.cursor.set(at);
    this.open.set(true);
  }

  protected close(refocus = false) {
    this.open.set(false);
    if (refocus) this.host.nativeElement.querySelector('input')?.focus();
  }

  protected step(months: number) {
    const [y, m] = this.month().split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 7);
    this.month.set(next);
    this.cursor.set(`${next}-01`);
  }

  protected pick(date: string) {
    if (date && this.blocked(date)) return;
    this.bad.set(false);
    this.value.set(date);
    this.close(true);
  }

  protected typed(text: string) {
    if (!text.trim()) {
      this.bad.set(false);
      if (this.clearable()) this.value.set('');
      return;
    }
    const date = parseDate(text);
    if (!date || this.blocked(date)) {
      this.bad.set(true);
      return;
    }
    this.bad.set(false);
    this.value.set(date);
    this.open.set(false);
  }

  /** Arrow keys move a day or a week, Page Up/Down a month, Enter picks. */
  protected move(e: KeyboardEvent) {
    const by: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next = this.cursor();
    if (e.key in by) next = addDays(next, by[e.key]);
    else if (e.key === 'PageUp' || e.key === 'PageDown') {
      const [y, m, d] = next.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1 + (e.key === 'PageUp' ? -1 : 1), d));
      next = dt.toISOString().slice(0, 10);
    } else return;
    e.preventDefault();
    this.cursor.set(next);
    this.month.set(next.slice(0, 7));
    setTimeout(() =>
      (
        this.host.nativeElement.querySelector(`[data-date="${next}"]`) as HTMLElement | null
      )?.focus(),
    );
  }

  @HostListener('document:mousedown', ['$event'])
  protected outside(e: MouseEvent) {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.open.set(false);
  }
}
