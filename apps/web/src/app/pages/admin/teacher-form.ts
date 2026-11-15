import { HttpClient, httpResource } from '@angular/common/http';
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
import { AuthService } from '../../core/auth.service';
import { centsToDollars, dollarsToCents, generatePassword } from '../../core/forms';
import { money, tierLabel } from '../../core/format';
import type { Curriculum, LevelPayRate, TeacherDetail, Tier } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { COUNTRIES } from '../../core/countries';

/** Add a teacher (/admin/teachers/new) or edit one (/admin/teachers/:id/edit). */
@Component({
  selector: 'app-admin-teacher-form',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <nav aria-label="Breadcrumb" class="muted">
        <a routerLink="/admin/teachers">Teachers</a> /
        {{ isNew() ? 'New teacher' : 'Edit ' + fullName() }}
      </nav>
      <h1>{{ isNew() ? 'Add a teacher' : 'Edit teacher' }}</h1>

      <form class="sections" (ngSubmit)="save()">
        <section class="card" aria-labelledby="s-account">
          <h2 id="s-account">Account and contact</h2>
          <div class="grid">
            <div class="field">
              <label for="t-name">Full name</label>
              <input
                id="t-name"
                name="fullName"
                required
                [ngModel]="fullName()"
                (ngModelChange)="fullName.set($event)"
              />
            </div>
            <div class="field">
              <label for="t-phone">Phone / WhatsApp <span class="muted">(optional)</span></label>
              <input
                id="t-phone"
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
                <label for="t-email">Email <span class="muted">· used to sign in</span></label>
                <input
                  id="t-email"
                  name="email"
                  type="email"
                  required
                  [ngModel]="email()"
                  (ngModelChange)="email.set($event)"
                />
              </div>
              <div class="field">
                <label for="t-pass">Temporary password</label>
                <div class="row">
                  <input
                    id="t-pass"
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
        </section>

        <section class="card" aria-labelledby="s-teaching">
          <h2 id="s-teaching">Teaching</h2>
          <div class="grid">
            <div class="field">
              <label for="t-level">Level</label>
              <select
                id="t-level"
                name="level"
                [ngModel]="level()"
                (ngModelChange)="level.set($event)"
              >
                <option value="PREMIUM">Premium · top teachers</option>
                <option value="STANDARD">Standard</option>
                <option value="BASIC">Basic</option>
              </select>
            </div>
            @if (!isNew()) {
              <div class="field">
                <label for="t-status">Status</label>
                <select
                  id="t-status"
                  name="status"
                  [ngModel]="status()"
                  (ngModelChange)="status.set($event)"
                >
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Not taking students</option>
                </select>
              </div>
            }
          </div>
          <div class="field">
            <label for="t-zoom">Meeting link (Zoom or Google Meet)</label>
            <input
              id="t-zoom"
              name="zoom"
              type="url"
              placeholder="https://zoom.us/j/…"
              [ngModel]="zoomLink()"
              (ngModelChange)="zoomLink.set($event)"
            />
          </div>
          <fieldset class="field">
            <legend>Curricula they can teach</legend>
            <div class="checks">
              @for (c of curricula.value(); track c.id) {
                <label class="check">
                  <input
                    type="checkbox"
                    [checked]="picked().includes(c.id)"
                    (change)="togglePick(c.id)"
                  />
                  {{ c.name }}{{ c.isActive ? '' : ' (inactive)' }}
                </label>
              } @empty {
                <span class="muted">No curricula yet. Add them under Curricula &amp; plans.</span>
              }
            </div>
          </fieldset>
          <div class="field">
            <label for="t-bio">About their teaching <span class="muted">(optional)</span></label>
            <textarea
              id="t-bio"
              name="bio"
              rows="3"
              [ngModel]="bio()"
              (ngModelChange)="bio.set($event)"
            ></textarea>
          </div>
        </section>

        <section class="card" aria-labelledby="s-personal">
          <h2 id="s-personal">Personal details <span class="muted">(optional)</span></h2>
          <div class="grid three">
            <div class="field">
              <label for="t-gender">Gender</label>
              <select id="t-gender" name="gender" [(ngModel)]="p.gender">
                <option value="">Not set</option>
                <option value="FEMALE">Female</option>
                <option value="MALE">Male</option>
              </select>
            </div>
            <div class="field">
              <label for="t-birth">Date of birth</label>
              <input id="t-birth" name="birthDate" type="date" [(ngModel)]="p.birthDate" />
            </div>
            <div class="field">
              <label for="t-joined">Joined the academy</label>
              <input id="t-joined" name="joinedOn" type="date" [(ngModel)]="p.joinedOn" />
            </div>
            <div class="field">
              <label for="t-country">Country</label>
              <select id="t-country" name="country" [(ngModel)]="p.country">
                <option value="">Not set</option>
                @for (c of countries; track c.code) {
                  <option [value]="c.code">{{ c.name }}</option>
                }
              </select>
            </div>
            <div class="field">
              <label for="t-city">City</label>
              <input id="t-city" name="city" [(ngModel)]="p.city" />
            </div>
            <div class="field">
              <label for="t-exp">Years of experience</label>
              <input
                id="t-exp"
                name="experienceYears"
                type="number"
                min="0"
                max="70"
                inputmode="numeric"
                [(ngModel)]="p.experienceYears"
              />
            </div>
          </div>
          <div class="field">
            <label for="t-address">Address</label>
            <input id="t-address" name="address" [(ngModel)]="p.address" />
          </div>
          <div class="grid">
            <div class="field">
              <label for="t-lang">Languages they speak</label>
              <input
                id="t-lang"
                name="languages"
                placeholder="Arabic, English"
                [(ngModel)]="p.languages"
              />
            </div>
            <div class="field">
              <label for="t-edu">Education and certificates</label>
              <textarea
                id="t-edu"
                name="education"
                rows="2"
                placeholder="Degree, ijazah…"
                [(ngModel)]="p.education"
              ></textarea>
            </div>
          </div>
        </section>

        @if (isAdmin()) {
          <section class="card" aria-labelledby="s-pay">
            <h2 id="s-pay">Pay <span class="muted">(only admins see this)</span></h2>
            <div class="grid">
              <div class="field">
                <label for="t-rate">Own rate per hour <span class="muted">(optional)</span></label>
                <input
                  id="t-rate"
                  name="rate"
                  type="number"
                  min="0"
                  step="0.5"
                  inputmode="decimal"
                  [placeholder]="levelRateText()"
                  aria-describedby="t-rate-hint"
                  [ngModel]="rate()"
                  (ngModelChange)="rate.set($event ?? '')"
                />
                <span id="t-rate-hint" class="muted small"
                  >Leave empty to pay the {{ tier(level()) }} level's rate{{
                    levelRate() ? ': ' + levelMoney() : ' (not set yet)'
                  }}. Level rates are on Lessons to pay.</span
                >
              </div>
              <div class="field">
                <label for="t-cur">Currency</label>
                <select
                  id="t-cur"
                  name="currency"
                  [ngModel]="currency()"
                  (ngModelChange)="currency.set($event)"
                >
                  @for (c of currencies; track c) {
                    <option [value]="c">{{ c }}</option>
                  }
                </select>
              </div>
            </div>
            <p class="muted small">
              Bank, InstaPay or wallet details are on the teacher's page, under Pay &amp; bank.
            </p>
          </section>
        }

        <div class="actions">
          <button class="btn primary" type="submit" [disabled]="busy()">
            {{ isNew() ? 'Add teacher' : 'Save' }}
          </button>
          <a class="btn" [routerLink]="isNew() ? '/admin/teachers' : ['/admin/teachers', id()]"
            >Cancel</a
          >
          @if (isNew()) {
            <span class="muted small">Next you'll set their weekly hours.</span>
          }
        </div>
      </form>
    </div>
  `,
  styles: `
    .sections {
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-width: 860px;
    }
    .sections .card {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .sections h2 {
      font-size: 16px;
      color: var(--ink);
    }
    .grid.three {
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    }
    .field textarea {
      min-height: 44px;
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
    fieldset {
      border: 0;
      padding: 0;
      margin: 0;
    }
    legend {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .checks {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .check {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 44px;
      padding: 0 12px;
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      font-weight: 500 !important;
    }
    .small {
      font-size: 13px;
      margin: 0;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .notice {
      margin: 0;
    }
  `,
})
export class AdminTeacherForm implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  readonly id = input<string>();

  protected readonly curricula = httpResource<Curriculum[]>(() => '/api/curricula', {
    defaultValue: [],
  });
  protected readonly isNew = computed(() => !this.id());
  protected readonly fullName = signal('');
  protected readonly phone = signal('');
  protected readonly email = signal('');
  protected readonly password = signal(generatePassword());
  protected readonly level = signal<Tier>('STANDARD');
  protected readonly status = signal('ACTIVE');
  protected readonly zoomLink = signal('');
  protected readonly bio = signal('');
  protected readonly isAdmin = computed(() => this.auth.hasRole('ADMIN'));
  protected readonly tier = tierLabel;
  /** admins only: the level rates, to say what an empty own rate means */
  private readonly levelRates = httpResource<LevelPayRate[]>(
    () => (this.isAdmin() ? '/api/level-pay-rates' : undefined),
    { defaultValue: [] },
  );
  protected readonly levelRate = computed(
    () =>
      this.levelRates.value().find((r) => r.level === this.level() && r.hourlyRateCents !== null) ??
      null,
  );
  protected readonly levelMoney = computed(() => {
    const r = this.levelRate();
    return r ? money(r.hourlyRateCents!, r.currency) : '';
  });
  protected readonly levelRateText = computed(() =>
    this.levelRate() ? `Level rate: ${this.levelMoney()}` : 'Not set',
  );
  /** per hour, as typed; '' = not set */
  protected readonly rate = signal<string | number>('');
  protected readonly currency = signal('EGP');
  protected readonly currencies = ['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED'];
  protected readonly picked = signal<string[]>([]);
  /** personal details, as typed ('' = not set) */
  protected p = {
    gender: '',
    birthDate: '',
    joinedOn: '',
    country: '',
    city: '',
    address: '',
    languages: '',
    education: '',
    experienceYears: '' as string | number,
  };
  protected readonly countries = COUNTRIES;
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly newPassword = generatePassword;

  async ngOnInit() {
    const id = this.id();
    if (!id) return;
    try {
      const t = await firstValueFrom(this.http.get<TeacherDetail>(`/api/teachers/${id}`));
      this.fullName.set(t.fullName);
      this.phone.set(t.phone ?? '');
      this.level.set(t.level);
      this.status.set(t.status);
      this.zoomLink.set(t.zoomLink ?? '');
      this.bio.set(t.bio ?? '');
      if (t.hourlyRateCents !== undefined) {
        this.rate.set(t.hourlyRateCents === null ? '' : centsToDollars(t.hourlyRateCents));
        this.currency.set(t.rateCurrency ?? 'EGP');
      }
      this.picked.set(t.curricula.map((c) => c.id));
      this.p = {
        gender: t.gender ?? '',
        birthDate: t.birthDate ?? '',
        joinedOn: t.joinedOn ?? '',
        country: t.country ?? '',
        city: t.city ?? '',
        address: t.address ?? '',
        languages: t.languages ?? '',
        education: t.education ?? '',
        experienceYears: t.experienceYears ?? '',
      };
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }

  protected togglePick(id: string) {
    this.picked.update((list) =>
      list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
    );
  }

  protected async save() {
    this.busy.set(true);
    this.error.set('');
    const common = {
      fullName: this.fullName(),
      phone: this.phone() || undefined,
      level: this.level(),
      zoomLink: this.zoomLink() || undefined,
      bio: this.bio() || undefined,
      curriculumIds: this.picked(),
      // Personal details: '' clears a field.
      gender: this.p.gender,
      birthDate: this.p.birthDate,
      country: this.p.country,
      city: this.p.city.trim(),
      address: this.p.address.trim(),
      languages: this.p.languages.trim(),
      education: this.p.education.trim(),
      experienceYears:
        String(this.p.experienceYears).trim() === '' ? null : Number(this.p.experienceYears),
      ...(this.p.joinedOn ? { joinedOn: this.p.joinedOn } : {}),
      // Only admins send pay; '' clears it.
      ...(this.isAdmin()
        ? {
            hourlyRateCents: String(this.rate()).trim() === '' ? null : dollarsToCents(this.rate()),
            rateCurrency: this.currency(),
          }
        : {}),
    };
    try {
      const id = this.id();
      if (id) {
        await this.api.updateTeacher(id, { ...common, status: this.status() });
        await this.router.navigate(['/admin/teachers', id]);
      } else {
        const created = await this.api.createTeacher({
          ...common,
          email: this.email(),
          password: this.password(),
        });
        await this.router.navigate(['/admin/teachers', created.id, 'availability'], {
          queryParams: { created: 1 },
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
