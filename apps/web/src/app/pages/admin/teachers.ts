import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { tierLabel } from '../../core/format';
import type { TeacherRow } from '../../core/models';
import { TeacherPay } from './teacher-pay';
import { PersonActions } from '../../shared/person-actions';
import { PageLog } from '../../shared/page-log';

@Component({
  selector: 'app-admin-teachers',
  imports: [PageLog, PersonActions, RouterLink, TeacherPay],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    td.act,
    th.act {
      width: 1%;
      text-align: right;
      white-space: nowrap;
    }
    .tools {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: flex-end;
    }
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    .filters .field {
      min-width: 150px;
    }
    .filters .grow {
      flex: 1 1 220px;
    }
  `,
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <h1>Teachers</h1>
          <p role="status">
            {{
              filtered().length === teachers.value().length
                ? teachers.value().length + ' teachers'
                : filtered().length + ' of ' + teachers.value().length + ' teachers'
            }}
          </p>
        </div>
        <div class="tools">
          @if (isAdmin) {
            <a class="btn" routerLink="import">Import from Excel</a>
          }
          @if (canEdit) {
            <a class="btn primary" routerLink="new">Add teacher</a>
          }
        </div>
      </header>
      <div class="filters" role="search" aria-label="Filter teachers">
        <div class="field grow">
          <label for="tq">Search</label>
          <input
            id="tq"
            type="search"
            placeholder="Name or email"
            [value]="query()"
            (input)="query.set($any($event.target).value)"
          />
        </div>
        <div class="field">
          <label for="t-level">Level</label>
          <select id="t-level" [value]="level()" (change)="level.set($any($event.target).value)">
            <option value="">Any</option>
            <option value="PREMIUM">Premium</option>
            <option value="STANDARD">Standard</option>
            <option value="BASIC">Basic</option>
          </select>
        </div>
        <div class="field">
          <label for="t-cur">Teaches</label>
          <select
            id="t-cur"
            [value]="curriculum()"
            (change)="curriculum.set($any($event.target).value)"
          >
            <option value="">Any curriculum</option>
            @for (c of curriculumNames(); track c) {
              <option [value]="c">{{ c }}</option>
            }
          </select>
        </div>
      </div>
      <section class="card flush" aria-label="Teacher list">
        <div class="table-wrap">
          <table class="data" style="min-width: 640px">
            <thead>
              <tr>
                <th>Teacher</th>
                <th>Level</th>
                <th>Curricula</th>
                <th>Status</th>
                <th class="act"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              @for (t of filtered(); track t.id) {
                <tr>
                  <td>
                    <a [routerLink]="[t.id]"
                      ><strong>{{ t.fullName }}</strong></a
                    ><span class="sub">{{ t.email }}</span>
                  </td>
                  <td>{{ tier(t.level) }}</td>
                  <td>{{ t.curricula.join(', ') || '—' }}</td>
                  <td>
                    <span class="chip" [class.ok]="t.status === 'ACTIVE'">{{
                      t.status.toLowerCase()
                    }}</span>
                  </td>
                  <td class="act">
                    <app-person-actions
                      [person]="{ kind: 'teacher', id: t.id, userId: t.userId, name: t.fullName }"
                      (changed)="teachers.reload()"
                    />
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="5" class="empty">
                    {{
                      teachers.isLoading()
                        ? 'Loading…'
                        : teachers.value().length
                          ? 'No teachers match.'
                          : 'No teachers yet.'
                    }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
      <app-teacher-pay />
      <app-page-log title="Activity on teachers" actions="teacher." />
    </div>
  `,
})
export class AdminTeachers {
  protected readonly isAdmin = inject(AuthService).user()?.role === 'ADMIN';
  /** staff accounts may be limited to other areas */
  protected readonly canEdit = inject(AuthService).can('teachers');
  protected readonly teachers = httpResource<TeacherRow[]>(() => '/api/teachers', {
    defaultValue: [],
  });
  protected readonly query = signal('');
  protected readonly level = signal('');
  protected readonly curriculum = signal('');
  protected readonly curriculumNames = computed(() =>
    [...new Set(this.teachers.value().flatMap((t) => t.curricula))].sort(),
  );
  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.teachers
      .value()
      .filter(
        (t) => !q || t.fullName.toLowerCase().includes(q) || t.email.toLowerCase().includes(q),
      )
      .filter((t) => !this.level() || t.level === this.level())
      .filter((t) => !this.curriculum() || t.curricula.includes(this.curriculum()));
  });
  protected readonly tier = tierLabel;
}
