import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, errorMessage } from '../../core/api.service';
import { time, timeZones } from '../../core/format';
import { generatePassword } from '../../core/forms';
import type { StudentDetail } from '../../core/models';
import { COUNTRIES } from '../../core/countries';
import { ToastService } from '../../core/toast.service';

/** Add a student (/admin/students/new) or edit one (/admin/students/:id/edit). */
@Component({
  selector: 'app-admin-student-form',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <nav aria-label="Breadcrumb" class="muted">
        <a routerLink="/admin/students">Students</a> /
        {{ isNew() ? 'New student' : 'Edit ' + fullName() }}
      </nav>
      <h1>{{ isNew() ? 'Add a student' : 'Edit student' }}</h1>

      <form class="card narrow" (ngSubmit)="save()">
        <div class="grid">
          <div class="field">
            <label for="f-name">Full name</label>
            <input
              id="f-name"
              name="fullName"
              required
              [ngModel]="fullName()"
              (ngModelChange)="fullName.set($event)"
            />
          </div>
          <div class="field">
            <label for="f-phone">Phone <span class="muted">(optional)</span></label>
            <input
              id="f-phone"
              name="phone"
              type="tel"
              [ngModel]="phone()"
              (ngModelChange)="phone.set($event)"
            />
          </div>
        </div>
        @if (isNew()) {
          <div class="grid">
            <div class="field">
              <label for="f-email">Email <span class="muted">· used to sign in</span></label>
              <input
                id="f-email"
                name="email"
                type="email"
                required
                [ngModel]="email()"
                (ngModelChange)="email.set($event)"
              />
            </div>
            <div class="field">
              <label for="f-pass">Temporary password</label>
              <div class="row">
                <input
                  id="f-pass"
                  name="password"
                  class="mono"
                  required
                  minlength="8"
                  [ngModel]="password()"
                  (ngModelChange)="password.set($event)"
                />
                <button type="button" class="btn" (click)="password.set(newPassword())">
                  New one
                </button>
              </div>
            </div>
          </div>
        }
        <div class="field">
          <label for="f-tz">Time zone</label>
          <select
            id="f-tz"
            name="timezone"
            [ngModel]="timezone()"
            (ngModelChange)="timezone.set($event)"
          >
            @for (z of zones; track z) {
              <option [value]="z">{{ z }}</option>
            }
          </select>
          <span class="muted small"
            >It's {{ localNow() }} there now. Weekly lessons are fixed to this clock.</span
          >
        </div>
        <div class="field">
          <label for="f-country">Country</label>
          <select
            id="f-country"
            name="country"
            [ngModel]="country()"
            (ngModelChange)="country.set($event)"
          >
            <option value="">Not set</option>
            @for (c of countries; track c.code) {
              <option [value]="c.code">{{ c.name }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label for="f-address">Address</label>
          <textarea
            id="f-address"
            name="address"
            rows="2"
            [ngModel]="address()"
            (ngModelChange)="address.set($event)"
          ></textarea>
        </div>
        @if (!isNew()) {
          <div class="field">
            <label for="f-status">Status</label>
            <select
              id="f-status"
              name="status"
              [ngModel]="status()"
              (ngModelChange)="status.set($event)"
            >
              <option value="ACTIVE">Active</option>
              <option value="PAUSED">Paused</option>
              <option value="EXITED">Left the academy</option>
            </select>
          </div>
          <p class="muted small">
            Changing the time zone here doesn't move existing lessons. To move a schedule, change
            the subscription's weekly slots.
          </p>
        }
        <div class="actions">
          <button class="btn primary" type="submit" [disabled]="busy()">
            {{ isNew() ? 'Add student' : 'Save' }}
          </button>
          <a class="btn" [routerLink]="isNew() ? '/admin/students' : ['/admin/students', id()]"
            >Cancel</a
          >
        </div>
      </form>
    </div>
  `,
  styles: `
    .narrow {
      max-width: 760px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 14px;
    }
    .row {
      display: flex;
      gap: 8px;
    }
    .row input {
      flex: 1;
      min-width: 0;
    }
    .mono {
      font-family: ui-monospace, monospace;
    }
    .small {
      font-size: 13px;
      margin: 0;
    }
    .actions {
      display: flex;
      gap: 8px;
    }
    .notice {
      margin: 0;
    }
  `,
})
export class AdminStudentForm implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  readonly id = input<string>();

  protected readonly isNew = computed(() => !this.id());
  protected readonly zones = timeZones();
  protected readonly fullName = signal('');
  protected readonly phone = signal('');
  protected readonly email = signal('');
  protected readonly password = signal(generatePassword());
  protected readonly timezone = signal('America/New_York');
  protected readonly status = signal('ACTIVE');
  protected readonly country = signal('');
  protected readonly address = signal('');
  protected readonly countries = COUNTRIES;
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly newPassword = generatePassword;
  protected readonly localNow = computed(() => time(new Date(), this.timezone()));

  async ngOnInit() {
    const id = this.id();
    if (!id) return;
    try {
      const s = await firstValueFrom(this.http.get<StudentDetail>(`/api/students/${id}`));
      this.fullName.set(s.fullName);
      this.phone.set(s.phone ?? '');
      this.timezone.set(s.timezone);
      this.status.set(s.status);
      this.country.set(s.country ?? '');
      this.address.set(s.address ?? '');
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  protected async save() {
    this.busy.set(true);
    this.error.set('');
    try {
      const id = this.id();
      if (id) {
        await this.api.updateStudent(id, {
          fullName: this.fullName(),
          phone: this.phone() || undefined,
          timezone: this.timezone(),
          status: this.status(),
          ...(this.country() ? { country: this.country() } : {}),
          address: this.address(),
        });
        await this.router.navigate(['/admin/students', id]);
      } else {
        const created = await this.api.createStudent({
          fullName: this.fullName(),
          phone: this.phone() || undefined,
          email: this.email(),
          password: this.password(),
          timezone: this.timezone(),
          ...(this.country() ? { country: this.country() } : {}),
          address: this.address() || undefined,
        });
        // Straight on to booking their lessons.
        await this.router.navigate(['/admin/students', created.id, 'add-lesson'], {
          queryParams: { created: 1, kind: 'weekly' },
          state: { password: this.password() },
        });
      }
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
