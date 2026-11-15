import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CurriculumBooks } from '../../shared/curriculum-books';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { centsToDollars, dollarsToCents } from '../../core/forms';
import type { Curriculum, Plan } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { PageLog } from '../../shared/page-log';

interface PlanDraft {
  id: string;
  name: string;
  tier: Plan['tier'];
  price: string;
  currency: string;
  cancelQuota: string;
  rescheduleQuota: string;
  lessonMinutes: number;
  hoursPerCycle: number;
  isActive: boolean;
}

const toDraft = (p: Plan): PlanDraft => ({
  id: p.id,
  name: p.name,
  tier: p.tier,
  price: centsToDollars(p.priceCents),
  currency: p.currency,
  cancelQuota: p.cancelQuota === null ? '' : String(p.cancelQuota),
  rescheduleQuota: p.rescheduleQuota === null ? '' : String(p.rescheduleQuota),
  lessonMinutes: p.lessonMinutes,
  hoursPerCycle: p.hoursPerCycle,
  isActive: p.isActive,
});

/** "2 a week" for the hours and minutes being typed. */
function perWeek(p: PlanDraft): string {
  const n = (Number(p.hoursPerCycle) * 60) / Number(p.lessonMinutes) / 4;
  return Number.isInteger(n) && n >= 1 && n <= 7 ? `${n} a week` : 'uneven';
}

const quota = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.floor(Number(v))));

/** Curricula and the three plans (prices and quotas). */
@Component({
  selector: 'app-admin-catalog',
  imports: [PageLog, FormsModule, CurriculumBooks],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header>
        <h1>Curricula &amp; plans</h1>
        <p class="muted">
          Plans set the hours of lessons in each 28-day cycle (that gives the lessons a week), the
          price of one lesson, and how many cancels and reschedules a student gets per cycle. Leave
          a quota empty for unlimited. Booked students keep their weekly lessons until their plan or
          times change.
        </p>
      </header>

      <section class="card flush">
        <div class="card-head">
          <h2>Plans</h2>
          @if (!isAdmin()) {
            <span class="muted">Only admins can change plans</span>
          }
        </div>
        <div class="table-wrap">
          <table class="data" style="min-width: 1000px">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Teacher level</th>
                <th>Hours / cycle</th>
                <th>Minutes</th>
                <th>Lessons</th>
                <th>Price / lesson</th>
                <th>Cancels</th>
                <th>Reschedules</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (p of drafts(); track p.id; let i = $index) {
                <tr>
                  <td>
                    <label class="sr-only" [attr.for]="'pn' + i">Plan name</label
                    ><input
                      [id]="'pn' + i"
                      class="in"
                      [(ngModel)]="p.name"
                      [disabled]="!isAdmin()"
                    />
                  </td>
                  <td>{{ p.tier.charAt(0) + p.tier.slice(1).toLowerCase() }}</td>
                  <td>
                    <label class="sr-only" [attr.for]="'ph' + i">Hours per cycle</label
                    ><input
                      [id]="'ph' + i"
                      class="in num short"
                      type="number"
                      min="1"
                      max="56"
                      [(ngModel)]="p.hoursPerCycle"
                      [disabled]="!isAdmin()"
                    />
                  </td>
                  <td>
                    <label class="sr-only" [attr.for]="'pm' + i">Lesson minutes</label
                    ><input
                      [id]="'pm' + i"
                      class="in num short"
                      type="number"
                      min="15"
                      max="180"
                      step="5"
                      [(ngModel)]="p.lessonMinutes"
                      [disabled]="!isAdmin()"
                    />
                  </td>
                  <td class="muted nowrap" [class.bad]="weekly(p) === 'uneven'">{{ weekly(p) }}</td>
                  <td>
                    <label class="sr-only" [attr.for]="'pp' + i">Price</label
                    ><input
                      [id]="'pp' + i"
                      class="in num price"
                      type="number"
                      min="0"
                      step="0.5"
                      [(ngModel)]="p.price"
                      [disabled]="!isAdmin()"
                    /><span class="muted cur">{{ p.currency }}</span>
                  </td>
                  <td>
                    <label class="sr-only" [attr.for]="'pc' + i">Cancels per cycle</label
                    ><input
                      [id]="'pc' + i"
                      class="in num short"
                      type="number"
                      min="0"
                      placeholder="∞"
                      [(ngModel)]="p.cancelQuota"
                      [disabled]="!isAdmin()"
                    />
                  </td>
                  <td>
                    <label class="sr-only" [attr.for]="'pr' + i">Reschedules per cycle</label
                    ><input
                      [id]="'pr' + i"
                      class="in num short"
                      type="number"
                      min="0"
                      placeholder="∞"
                      [(ngModel)]="p.rescheduleQuota"
                      [disabled]="!isAdmin()"
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      [(ngModel)]="p.isActive"
                      [disabled]="!isAdmin()"
                      [attr.aria-label]="p.name + ' active'"
                    />
                  </td>
                  <td>
                    @if (isAdmin()) {
                      <button
                        type="button"
                        class="btn small"
                        [disabled]="busy()"
                        (click)="savePlan(p)"
                      >
                        Save
                      </button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="10" class="empty">No plans yet.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="card flush">
        <div class="card-head"><h2>Curricula</h2></div>
        @for (c of curricula.value(); track c.id) {
          <div class="list-row">
            <strong class="grow">{{ c.name }}</strong>
            <span class="chip" [class.ok]="c.isActive">{{
              c.isActive ? 'active' : 'inactive'
            }}</span>
            <button
              type="button"
              class="btn small"
              [attr.aria-expanded]="booksOf() === c.id"
              (click)="booksOf.set(booksOf() === c.id ? null : c.id)"
            >
              Books
            </button>
            <button
              type="button"
              class="btn small"
              [disabled]="busy()"
              (click)="toggleCurriculum(c)"
            >
              {{ c.isActive ? 'Turn off' : 'Turn on' }}
            </button>
          </div>
          @if (booksOf() === c.id) {
            <div class="books-panel">
              <app-curriculum-books [curriculumId]="c.id" [name]="c.name" [canEdit]="true" />
            </div>
          }
        } @empty {
          <p class="empty">No curricula yet.</p>
        }
        <form class="list-row add" (ngSubmit)="addCurriculum()">
          <label class="sr-only" for="new-cur">New curriculum name</label>
          <input
            id="new-cur"
            name="name"
            class="in grow"
            placeholder="New curriculum, e.g. Foundations 3"
            [(ngModel)]="newCurriculum"
          />
          <button
            type="submit"
            class="btn small primary"
            [disabled]="busy() || !newCurriculum.trim()"
          >
            Add
          </button>
        </form>
      </section>
      <app-page-log title="Activity on curricula and plans" actions="curriculum.,plan." />
    </div>
  `,
  styles: `
    .books-panel {
      padding: 12px 18px 16px;
      border-top: 1px dashed var(--border);
      background: var(--ground, #f6f6f2);
    }
    header p {
      margin: 6px 0 0;
    }
    .in {
      min-height: 40px;
      padding: 0 10px;
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      font: inherit;
      width: 140px;
    }
    .in.short {
      width: 72px;
    }
    .in.price {
      width: 104px;
    }
    td {
      vertical-align: middle;
    }
    .cur {
      margin-left: 8px;
      font-size: 13px;
    }
    .nowrap {
      white-space: nowrap;
    }
    .bad {
      color: var(--danger);
      font-weight: 600;
    }
    .in:disabled {
      background: #f4f4f0;
    }
    .grow {
      flex: 1 1 200px;
    }
    .add .in {
      width: auto;
    }
    .notice {
      margin: 0 22px 16px;
    }
  `,
})
export class AdminCatalog {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  protected readonly isAdmin = computed(() => this.auth.user()?.role === 'ADMIN');
  private readonly plans = httpResource<Plan[]>(() => '/api/plans', { defaultValue: [] });
  /** the curriculum whose books are open */
  protected readonly booksOf = signal<string | null>(null);
  protected readonly curricula = httpResource<Curriculum[]>(() => '/api/curricula', {
    defaultValue: [],
  });
  protected readonly drafts = signal<PlanDraft[]>([]);
  protected readonly busy = signal(false);
  private readonly toast = inject(ToastService);
  protected readonly curMsg = signal('');
  protected newCurriculum = '';

  constructor() {
    effect(() => this.drafts.set(this.plans.value().map(toDraft)));
  }

  protected readonly weekly = perWeek;

  protected async savePlan(p: PlanDraft) {
    this.busy.set(true);
    try {
      await this.api.savePlan(
        {
          name: p.name,
          priceCents: dollarsToCents(p.price),
          cancelQuota: quota(p.cancelQuota),
          rescheduleQuota: quota(p.rescheduleQuota),
          lessonMinutes: Number(p.lessonMinutes),
          hoursPerCycle: Number(p.hoursPerCycle),
          isActive: p.isActive,
        },
        p.id,
      );
      this.toast.success(`${p.name} saved. New prices apply to invoices issued from now on.`);
      this.plans.reload();
    } catch {
      // the message at the top says why
    } finally {
      this.busy.set(false);
    }
  }

  protected async addCurriculum() {
    this.busy.set(true);
    this.curMsg.set('');
    try {
      await this.api.saveCurriculum({ name: this.newCurriculum.trim() });
      this.newCurriculum = '';
      this.curricula.reload();
    } catch (err) {
      this.curMsg.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async toggleCurriculum(c: Curriculum) {
    this.busy.set(true);
    this.curMsg.set('');
    try {
      await this.api.saveCurriculum({ isActive: !c.isActive }, c.id);
      this.curricula.reload();
    } catch (err) {
      this.curMsg.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
