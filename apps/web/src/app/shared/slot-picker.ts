import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../core/api.service';
import type { FreeSlots } from '../core/models';
import { DateField } from './date-field';

/**
 * Pick a day, then one of the teacher's free times that day for this lesson
 * (on the student's clock, with Cairo time underneath).
 */
@Component({
  selector: 'app-slot-picker',
  imports: [DateField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field">
      <label [attr.for]="uid + '-date'">Day ({{ timezone() }})</label>
      <app-date-field [inputId]="uid + '-date'" [value]="date()" (valueChange)="load($event)" />
    </div>
    <div class="slots" role="group" aria-label="Free times">
      @for (s of slots(); track s.startsAt) {
        <button
          type="button"
          [class.on]="chosen() === s.startsAt"
          [attr.aria-pressed]="chosen() === s.startsAt"
          (click)="chosen.set(s.startsAt)"
        >
          <strong>{{ s.local }}</strong
          ><span>{{ s.cairo }} Cairo</span>
        </button>
      } @empty {
        <p class="muted none">
          {{ loading() ? 'Loading…' : error() || 'No free time with this teacher on that day.' }}
        </p>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .slots {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 8px;
    }
    .slots button {
      min-height: 56px;
      border: 1px solid var(--border-strong);
      border-radius: 10px;
      background: #fff;
      font: inherit;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .slots button span {
      font-size: 12px;
      color: var(--muted);
    }
    .slots button.on {
      border: 2px solid var(--primary);
      background: var(--primary-tint);
      color: var(--primary);
    }
    .none {
      grid-column: 1 / -1;
      margin: 0;
    }
  `,
})
export class SlotPicker {
  private static next = 0;
  private readonly http = inject(HttpClient);
  protected readonly uid = `sp${SlotPicker.next++}`;

  readonly lessonId = input.required<string>();
  readonly timezone = input.required<string>();
  /** The day shown first ("YYYY-MM-DD"). */
  readonly startDate = input.required<string>();
  /** The chosen start time (ISO), or null. */
  readonly chosen = model<string | null>(null);

  protected readonly date = signal('');
  protected readonly slots = signal<FreeSlots['slots']>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal('');

  constructor() {
    effect(() => {
      const first = this.startDate();
      untracked(() => void this.load(first));
    });
  }

  protected async load(date: string) {
    if (!date) return;
    this.date.set(date);
    this.chosen.set(null);
    this.loading.set(true);
    this.error.set('');
    try {
      const res = await firstValueFrom(
        this.http.get<FreeSlots>(`/api/lessons/${this.lessonId()}/free-slots`, {
          params: { date },
        }),
      );
      this.slots.set(res.slots);
    } catch (err) {
      this.slots.set([]);
      this.error.set(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
