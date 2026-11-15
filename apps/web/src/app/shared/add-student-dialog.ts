import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { COUNTRIES, COUNTRY_ZONES } from '../core/countries';
import { time, timeZones } from '../core/format';
import { generatePassword } from '../core/forms';
import { ToastService } from '../core/toast.service';

/**
 * Add a student in a pop-up: their details only. Lessons can be booked now
 * (a subscription or a free trial) or later.
 */
@Component({
  selector: 'app-add-student-dialog',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg aria-labelledby="as-title" (close)="closed.emit()">
      @if (!created()) {
        <form (ngSubmit)="save()" class="form">
          <div class="head">
            <h2 id="as-title">Add student</h2>
            <button type="button" class="btn small" aria-label="Close" (click)="close()">✕</button>
          </div>
          <div class="grid">
            <div class="field">
              <label for="as-name">Full name</label>
              <input id="as-name" name="name" required minlength="2" [(ngModel)]="fullName" />
            </div>
            <div class="field">
              <label for="as-email">Email (their sign-in)</label>
              <input id="as-email" name="email" type="email" required [(ngModel)]="email" />
            </div>
            <div class="field">
              <label for="as-phone">Phone / WhatsApp</label>
              <input
                id="as-phone"
                name="phone"
                type="tel"
                [(ngModel)]="phone"
                placeholder="+1 555 123 4567"
              />
            </div>
            <div class="field">
              <label for="as-country">Country</label>
              <select
                id="as-country"
                name="country"
                required
                [ngModel]="country()"
                (ngModelChange)="pickCountry($event)"
              >
                <option value="" disabled>Choose…</option>
                @for (c of countries; track c.code) {
                  <option [value]="c.code">{{ c.name }}</option>
                }
              </select>
            </div>
            <div class="field">
              <label for="as-tz">Time zone</label>
              <select
                id="as-tz"
                name="tz"
                required
                [ngModel]="timezone()"
                (ngModelChange)="timezone.set($event)"
              >
                @for (z of zones; track z) {
                  <option [value]="z">{{ z }}</option>
                }
              </select>
              <span class="muted small">Their time now: {{ localNow() }}</span>
            </div>
            <div class="field">
              <label for="as-pass">Temporary password</label>
              <div class="pw">
                <input id="as-pass" name="password" required minlength="8" [(ngModel)]="password" />
                <button type="button" class="btn small" (click)="password = newPassword()">
                  New
                </button>
              </div>
            </div>
          </div>
          <div class="field">
            <label for="as-address">Address</label>
            <textarea
              id="as-address"
              name="address"
              rows="2"
              required
              [(ngModel)]="address"
              placeholder="Street, city, postcode"
            ></textarea>
          </div>
          <div class="actions">
            <button type="submit" class="btn primary" [disabled]="busy()">Add student</button>
            <button type="button" class="btn" (click)="close()">Cancel</button>
          </div>
        </form>
      } @else {
        <div class="form">
          <div class="head">
            <h2 id="as-title">{{ created()!.name }} was added</h2>
            <button type="button" class="btn small" aria-label="Close" (click)="close()">✕</button>
          </div>
          <p class="notice ok" role="status">
            <span
              >Their sign-in is {{ created()!.email }} with the temporary password
              <strong class="mono">{{ created()!.password }}</strong
              >. Send it to them now; it is not shown again.</span
            >
          </p>
          <p class="muted">Book their lessons now, or later from their page.</p>
          <div class="actions">
            <button type="button" class="btn primary" (click)="go('weekly')">
              Book weekly lessons
            </button>
            <button type="button" class="btn" (click)="go('trial')">
              Book a free trial lesson
            </button>
            <button type="button" class="btn" (click)="go('')">Open their page</button>
          </div>
        </div>
      }
    </dialog>
  `,
  styles: `
    dialog {
      width: min(680px, calc(100vw - 24px));
      border: 0;
      border-radius: 14px;
      padding: 22px;
    }
    dialog::backdrop {
      background: rgb(0 0 0 / 35%);
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }
    h2 {
      margin: 0;
      font-size: 20px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
    }
    .pw {
      display: flex;
      gap: 6px;
    }
    .pw input {
      flex: 1;
      min-width: 0;
    }
    textarea {
      width: 100%;
      box-sizing: border-box;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .small {
      font-size: 12px;
    }
    .notice {
      margin: 0;
    }
  `,
})
export class AddStudentDialog {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  /** after closing; `added` carries the new student's id */
  readonly closed = output<void>();
  readonly added = output<string>();

  protected readonly countries = COUNTRIES;
  protected readonly zones = timeZones();
  protected readonly newPassword = generatePassword;
  protected fullName = '';
  protected email = '';
  protected phone = '';
  protected address = '';
  protected password = generatePassword();
  protected readonly country = signal('');
  protected readonly timezone = signal('America/New_York');
  protected readonly localNow = computed(() => time(new Date(), this.timezone()));
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly created = signal<{
    id: string;
    name: string;
    email: string;
    password: string;
  } | null>(null);

  /** Open empty, or filled in (e.g. from a website application). */
  open(
    prefill: Partial<{
      fullName: string;
      email: string;
      phone: string;
      country: string;
      timezone: string;
    }> = {},
  ) {
    this.fullName = prefill.fullName ?? '';
    this.email = prefill.email ?? '';
    this.phone = prefill.phone ?? '';
    this.address = '';
    this.password = generatePassword();
    this.country.set('');
    this.timezone.set('America/New_York');
    if (prefill.country) this.pickCountry(prefill.country);
    if (prefill.timezone && this.zones.includes(prefill.timezone))
      this.timezone.set(prefill.timezone);
    this.error.set('');
    this.created.set(null);
    this.dlg().nativeElement.showModal();
  }

  protected close() {
    this.dlg().nativeElement.close();
  }

  /** Picking a country suggests its main time zone; it can still be changed. */
  protected pickCountry(code: string) {
    this.country.set(code);
    const zone = COUNTRY_ZONES[code];
    if (zone && this.zones.includes(zone)) this.timezone.set(zone);
  }

  protected async save() {
    if (!this.country()) {
      this.toast.error('Choose their country.');
      return;
    }
    if (!this.address.trim()) {
      this.toast.error('Add their address.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const res = await this.api.createStudent({
        fullName: this.fullName.trim(),
        email: this.email.trim(),
        phone: this.phone.trim() || undefined,
        password: this.password,
        timezone: this.timezone(),
        country: this.country(),
        address: this.address.trim(),
      });
      this.created.set({
        id: res.id,
        name: this.fullName.trim(),
        email: this.email.trim(),
        password: this.password,
      });
      this.added.emit(res.id);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected go(kind: '' | 'weekly' | 'trial') {
    const c = this.created();
    if (!c) return;
    this.close();
    void this.router.navigate(
      kind ? ['/admin/students', c.id, 'add-lesson'] : ['/admin/students', c.id],
      kind ? { queryParams: { kind } } : undefined,
    );
  }
}
