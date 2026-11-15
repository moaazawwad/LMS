import { HttpClient, httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/api.service';
import { COUNTRIES } from '../../core/countries';
import { ACADEMY_TZ, dayTime } from '../../core/format';
import { AddStudentDialog } from '../../shared/add-student-dialog';
import { ToastService } from '../../core/toast.service';

export interface Application {
  id: string;
  status: 'NEW' | 'CONTACTED' | 'TRIAL_BOOKED' | 'CONVERTED' | 'REJECTED';
  fullName: string;
  email: string;
  phone: string | null;
  country: string | null;
  timezone: string | null;
  curriculum: string | null;
  preferredTimes: string | null;
  studentAge: string | null;
  level: string | null;
  message: string | null;
  source: string | null;
  utm: string | null;
  notes: string | null;
  studentId: string | null;
  createdAt: string;
  handledAt: string | null;
}

const LABEL: Record<Application['status'], string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  TRIAL_BOOKED: 'Trial booked',
  CONVERTED: 'Student',
  REJECTED: 'Not going ahead',
};

/** People who applied on the website: details, follow-up and turning them into students. */
@Component({
  selector: 'app-applications',
  imports: [RouterLink, AddStudentDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="filters" role="group" aria-label="Show applications">
      @for (s of shows; track s.id) {
        <button
          type="button"
          class="btn small"
          [class.on]="show() === s.id"
          [attr.aria-pressed]="show() === s.id"
          (click)="show.set(s.id)"
        >
          {{ s.label }}
        </button>
      }
    </div>
    <div class="list">
      @for (a of list.value(); track a.id) {
        <article class="card app" [attr.aria-labelledby]="'ap-' + a.id">
          <div class="top">
            <div>
              <h2 [id]="'ap-' + a.id">{{ a.fullName }}</h2>
              <span class="muted small">Applied {{ when(a.createdAt) }} Cairo</span>
            </div>
            <span
              class="chip"
              [class.info]="a.status === 'NEW'"
              [class.ok]="a.status === 'CONVERTED'"
              >{{ label[a.status] }}</span
            >
          </div>
          <dl>
            <dt>Email</dt>
            <dd>
              <a [href]="'mailto:' + a.email">{{ a.email }}</a>
            </dd>
            @if (a.phone) {
              <dt>Phone</dt>
              <dd>
                <a [href]="'tel:' + a.phone">{{ a.phone }}</a> ·
                <a [href]="whatsapp(a.phone)" target="_blank" rel="noopener">WhatsApp</a>
              </dd>
            }
            @if (a.country || a.timezone) {
              <dt>Where</dt>
              <dd>{{ join(a.country, a.timezone) }}</dd>
            }
            @if (a.curriculum) {
              <dt>Wants</dt>
              <dd>{{ a.curriculum }}{{ a.level ? ' · level: ' + a.level : '' }}</dd>
            }
            @if (a.studentAge) {
              <dt>Student's age</dt>
              <dd>{{ a.studentAge }}</dd>
            }
            @if (a.preferredTimes) {
              <dt>Good times</dt>
              <dd class="pre">{{ a.preferredTimes }}</dd>
            }
            @if (a.message) {
              <dt>Message</dt>
              <dd class="pre">{{ a.message }}</dd>
            }
            @if (a.source || a.utm) {
              <dt>From</dt>
              <dd class="small">{{ join(a.source, a.utm) }}</dd>
            }
          </dl>
          <div class="field">
            <label [for]="'an-' + a.id">Notes (only the academy sees them)</label>
            <textarea
              [id]="'an-' + a.id"
              rows="2"
              [value]="a.notes ?? ''"
              (change)="save(a, { notes: $any($event.target).value })"
            ></textarea>
          </div>
          <div class="actions">
            @if (a.studentId) {
              <a class="btn primary" [routerLink]="['/admin/students', a.studentId]"
                >Open student</a
              >
              <a
                class="btn"
                [routerLink]="['/admin/students', a.studentId, 'add-lesson']"
                [queryParams]="{ kind: 'trial' }"
                >Book trial</a
              >
            } @else {
              <button type="button" class="btn primary" (click)="convert(a)">Add as student</button>
            }
            @if (a.status === 'NEW') {
              <button
                type="button"
                class="btn"
                [disabled]="busy()"
                (click)="save(a, { status: 'CONTACTED' })"
              >
                Mark contacted
              </button>
            }
            @if (a.status !== 'REJECTED' && a.status !== 'CONVERTED') {
              <button
                type="button"
                class="btn"
                [disabled]="busy()"
                (click)="save(a, { status: 'REJECTED' })"
              >
                Not going ahead
              </button>
            }
            @if (a.status === 'REJECTED') {
              <button
                type="button"
                class="btn"
                [disabled]="busy()"
                (click)="save(a, { status: 'CONTACTED' })"
              >
                Reopen
              </button>
            }
          </div>
        </article>
      } @empty {
        <p class="card empty">{{ list.isLoading() ? 'Loading…' : 'No applications here.' }}</p>
      }
    </div>
    <app-add-student-dialog #add (added)="added($event)" />
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .filters .on {
      background: var(--primary);
      color: #fff;
      border-color: var(--primary);
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .app {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .top {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
    }
    h2 {
      margin: 0;
      font-size: 17px;
    }
    dl {
      margin: 0;
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 6px 14px;
      font-size: 14px;
    }
    dt {
      color: var(--muted);
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .pre {
      white-space: pre-line;
    }
    .small {
      font-size: 12px;
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
    .notice {
      margin: 0;
    }
  `,
})
export class Applications {
  private readonly http = inject(HttpClient);
  private readonly addDialog = viewChild.required<AddStudentDialog>('add');
  /** after a change, so the page can update its counts */
  readonly changed = output<void>();
  protected readonly label = LABEL;
  protected readonly shows = [
    { id: 'NEW', label: 'New' },
    { id: 'CONTACTED', label: 'Contacted' },
    { id: 'CONVERTED', label: 'Students' },
    { id: 'REJECTED', label: 'Not going ahead' },
    { id: '', label: 'All' },
  ];
  protected readonly show = signal('NEW');
  protected readonly list = httpResource<Application[]>(
    () => ({
      url: '/api/applications',
      params: this.show() ? { status: this.show() } : ({} as Record<string, string>),
    }),
    { defaultValue: [] },
  );
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  private readonly toast = inject(ToastService);
  private converting: Application | null = null;

  protected when(iso: string) {
    return dayTime(iso, ACADEMY_TZ);
  }
  protected join(...parts: (string | null)[]) {
    return parts.filter((p) => !!p).join(' · ');
  }
  protected whatsapp(phone: string) {
    return `https://wa.me/${phone.replace(/[^0-9]/g, '')}`;
  }

  protected async save(
    a: Application,
    change: Partial<Pick<Application, 'status' | 'notes'>> & { studentId?: string },
  ) {
    this.busy.set(true);
    this.error.set('');
    try {
      await firstValueFrom(this.http.patch(`/api/applications/${a.id}`, change));
      if (change.status) this.toast.success(`${a.fullName}: ${LABEL[change.status]}.`);
      this.list.reload();
      this.changed.emit();
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  /** Open "Add student" filled in from the application. */
  protected convert(a: Application) {
    this.converting = a;
    const byName = COUNTRIES.find(
      (c) =>
        c.code === a.country?.toUpperCase() || c.name.toLowerCase() === a.country?.toLowerCase(),
    );
    this.addDialog().open({
      fullName: a.fullName,
      email: a.email,
      phone: a.phone ?? '',
      country: byName?.code ?? '',
      timezone: a.timezone ?? '',
    });
  }

  protected async added(studentId: string) {
    const a = this.converting;
    this.converting = null;
    if (a) await this.save(a, { status: 'CONVERTED', studentId });
  }
}
