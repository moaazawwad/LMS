import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { generatePassword } from '../../core/forms';
import { STAFF_AREAS, type StaffArea, type StaffMember } from '../../core/models';
import { ResetPasswordDialog } from '../../shared/reset-password-dialog';
import { ToastService } from '../../core/toast.service';
import { PageLog } from '../../shared/page-log';

/** Staff & roles: admins run everything, staff do the day-to-day work. */
@Component({
  selector: 'app-admin-staff',
  imports: [PageLog, FormsModule, ResetPasswordDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header>
        <h1>Staff &amp; roles</h1>
        <p class="muted">
          <strong>Admin</strong>: everything, including staff, plan prices, teacher pay and voiding
          invoices. <strong>Staff</strong>: the parts you tick for each person. Everyone on the
          staff can look up students, teachers and lessons.
        </p>
      </header>

      <section class="card flush">
        <div class="table-wrap">
          <table class="data" style="min-width: 760px">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Works on</th>
                <th>Sign-in</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (m of staff.value(); track m.id) {
                <tr>
                  <td>
                    <strong>{{ m.fullName }}</strong
                    >{{ m.id === me() ? ' (you)' : '' }}<span class="sub">{{ m.email }}</span>
                  </td>
                  <td>
                    <label class="sr-only" [attr.for]="'role-' + m.id"
                      >Role of {{ m.fullName }}</label
                    >
                    <select
                      [id]="'role-' + m.id"
                      [value]="m.role"
                      [disabled]="busy() || m.id === me()"
                      (change)="setRole(m, $any($event.target).value)"
                    >
                      <option value="ADMIN" [selected]="m.role === 'ADMIN'">Admin</option>
                      <option value="STAFF" [selected]="m.role === 'STAFF'">Staff</option>
                    </select>
                  </td>
                  <td class="areas">
                    @if (m.role === 'ADMIN') {
                      <span class="muted">Everything</span>
                    } @else {
                      <span>{{ areasText(m.areas) }}</span>
                      <button
                        type="button"
                        class="btn small"
                        [attr.aria-expanded]="editing() === m.id"
                        [attr.aria-label]="'Change what ' + m.fullName + ' works on'"
                        (click)="edit(m)"
                      >
                        Change
                      </button>
                    }
                  </td>
                  <td>
                    <span class="chip" [class.ok]="m.isActive">{{
                      m.isActive ? 'on' : 'off'
                    }}</span>
                  </td>
                  <td class="acts">
                    <button
                      type="button"
                      class="btn small"
                      (click)="resetFor.set({ userId: m.id, name: m.fullName })"
                    >
                      Reset password
                    </button>
                    @if (m.id !== me()) {
                      <button
                        type="button"
                        class="btn small"
                        [disabled]="busy()"
                        (click)="toggle(m)"
                      >
                        {{ m.isActive ? 'Turn off sign-in' : 'Turn on sign-in' }}
                      </button>
                    }
                  </td>
                </tr>
                @if (editing() === m.id) {
                  <tr class="edit-row">
                    <td colspan="5">
                      <fieldset class="picks">
                        <legend>What {{ m.fullName }} works on</legend>
                        @for (a of allAreas; track a.area) {
                          <label
                            ><input
                              type="checkbox"
                              [checked]="draft().includes(a.area)"
                              (change)="flip(a.area)"
                            />
                            <span
                              ><strong>{{ a.label }}</strong
                              ><span class="muted">{{ ' · ' + a.hint }}</span></span
                            ></label
                          >
                        }
                      </fieldset>
                      <div class="row-actions">
                        <button type="button" class="btn" (click)="editing.set(null)">
                          Cancel
                        </button>
                        <button
                          type="button"
                          class="btn primary"
                          [disabled]="busy()"
                          (click)="saveAreas(m)"
                        >
                          Save
                        </button>
                      </div>
                    </td>
                  </tr>
                }
              } @empty {
                <tr>
                  <td colspan="5" class="empty">
                    {{ staff.isLoading() ? 'Loading…' : 'No staff yet.' }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <form class="card narrow" (ngSubmit)="add()">
        <h2>Add someone</h2>
        <div class="grid">
          <div class="field">
            <label for="st-name">Full name</label>
            <input id="st-name" name="fullName" required [(ngModel)]="fullName" />
          </div>
          <div class="field">
            <label for="st-email">Email</label>
            <input id="st-email" name="email" type="email" required [(ngModel)]="email" />
          </div>
          <div class="field">
            <label for="st-role">Role</label>
            <select id="st-role" name="role" [(ngModel)]="role">
              <option value="STAFF">Staff</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>
          <div class="field">
            <label for="st-pass">Temporary password</label>
            <input
              id="st-pass"
              name="password"
              class="mono"
              required
              minlength="8"
              [(ngModel)]="password"
            />
          </div>
        </div>
        @if (role === 'STAFF') {
          <fieldset class="picks">
            <legend>Works on</legend>
            @for (a of allAreas; track a.area) {
              <label
                ><input
                  type="checkbox"
                  [name]="'new-' + a.area"
                  [checked]="newAreas().includes(a.area)"
                  (change)="flipNew(a.area)"
                />
                <span
                  ><strong>{{ a.label }}</strong
                  ><span class="muted">{{ ' · ' + a.hint }}</span></span
                ></label
              >
            }
          </fieldset>
        }
        <div><button class="btn primary" type="submit" [disabled]="busy()">Add</button></div>
      </form>
      <app-page-log title="Activity on staff and sign-ins" actions="staff.,user.,auth." />
    </div>
    <app-reset-password-dialog [person]="resetFor()" (closed)="resetFor.set(null)" />
  `,
  styles: `
    header p {
      margin: 6px 0 0;
      line-height: 1.5;
    }
    .narrow {
      max-width: 820px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 14px;
    }
    .mono {
      font-family: ui-monospace, monospace;
    }
    select {
      min-height: 40px;
      padding: 0 8px;
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      font: inherit;
      background: #fff;
    }
    .acts {
      white-space: nowrap;
      text-align: right;
    }
    .acts .btn + .btn {
      margin-left: 6px;
    }
    .notice {
      margin: 0;
    }
    .areas {
      min-width: 220px;
    }
    .areas > span {
      display: block;
      font-size: 13px;
      margin-bottom: 4px;
    }
    .edit-row td {
      background: var(--surface-muted);
    }
    .picks {
      border: 0;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 8px;
    }
    .picks legend {
      font-weight: 600;
      margin-bottom: 8px;
      padding: 0;
    }
    .picks label {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      font-size: 14px;
      cursor: pointer;
    }
    .picks input {
      width: 18px;
      height: 18px;
      margin-top: 1px;
      flex: none;
    }
    .row-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 12px;
    }
  `,
})
export class AdminStaff {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  protected readonly staff = httpResource<StaffMember[]>(() => '/api/staff', { defaultValue: [] });
  protected readonly me = computed(() => this.auth.user()?.userId);
  protected readonly busy = signal(false);
  private readonly toast = inject(ToastService);
  protected readonly resetFor = signal<{ userId: string; name: string } | null>(null);
  protected fullName = '';
  protected email = '';
  protected role: 'ADMIN' | 'STAFF' = 'STAFF';
  protected password = generatePassword();
  protected readonly allAreas = STAFF_AREAS;
  /** areas ticked for someone new (all by default) */
  protected readonly newAreas = signal<StaffArea[]>(STAFF_AREAS.map((a) => a.area));
  /** whose areas are being changed, and the ticks so far */
  protected readonly editing = signal<string | null>(null);
  protected readonly draft = signal<StaffArea[]>([]);

  protected areasText(areas: StaffArea[] | null) {
    if (!areas) return 'Everything';
    if (!areas.length) return 'Looking things up only';
    return STAFF_AREAS.filter((a) => areas.includes(a.area))
      .map((a) => a.label)
      .join(', ');
  }

  protected edit(m: StaffMember) {
    if (this.editing() === m.id) return this.editing.set(null);
    this.draft.set(m.areas ?? STAFF_AREAS.map((a) => a.area));
    this.editing.set(m.id);
  }

  protected flip(area: StaffArea) {
    this.draft.update((d) => (d.includes(area) ? d.filter((a) => a !== area) : [...d, area]));
  }

  protected flipNew(area: StaffArea) {
    this.newAreas.update((d) => (d.includes(area) ? d.filter((a) => a !== area) : [...d, area]));
  }

  protected saveAreas(m: StaffMember) {
    return this.run(async () => {
      const saved = await this.api.updateStaff(m.id, { areas: this.draft() });
      this.editing.set(null);
      return `${m.fullName} now works on: ${this.areasText(saved.areas).toLowerCase()}.`;
    });
  }

  private async run(action: () => Promise<string>) {
    this.busy.set(true);
    try {
      this.toast.success(await action());
    } catch {
      // the message at the top says why
    } finally {
      this.busy.set(false);
      this.staff.reload();
    }
  }

  protected setRole(m: StaffMember, role: 'ADMIN' | 'STAFF') {
    return this.run(async () => {
      await this.api.updateStaff(m.id, { role });
      return `${m.fullName} is now ${role === 'ADMIN' ? 'an admin' : 'staff'}. They need to sign in again.`;
    });
  }

  protected toggle(m: StaffMember) {
    return this.run(async () => {
      await this.api.updateStaff(m.id, { isActive: !m.isActive });
      return `${m.fullName}'s sign-in is ${m.isActive ? 'off' : 'on'}.`;
    });
  }

  protected add() {
    return this.run(async () => {
      const created = await this.api.createStaff({
        fullName: this.fullName,
        email: this.email,
        role: this.role,
        password: this.password,
        areas: this.role === 'STAFF' ? this.newAreas() : undefined,
      });
      const msg = `${created.fullName} added. Temporary password: ${this.password}`;
      this.fullName = '';
      this.email = '';
      this.role = 'STAFF';
      this.password = generatePassword();
      this.newAreas.set(STAFF_AREAS.map((a) => a.area));
      return msg;
    });
  }
}
