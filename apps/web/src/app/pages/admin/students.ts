import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { city, tierLabel } from '../../core/format';
import type { StudentRow } from '../../core/models';
import { PersonActions } from '../../shared/person-actions';
import { AddStudentDialog } from '../../shared/add-student-dialog';
import { PageLog } from '../../shared/page-log';

@Component({
  selector: 'app-admin-students',
  imports: [PageLog, AddStudentDialog, PersonActions, RouterLink],
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
          <h1>Students</h1>
          <p role="status">
            {{
              filtered().length === students.value().length
                ? students.value().length + ' students'
                : filtered().length + ' of ' + students.value().length + ' students'
            }}
          </p>
        </div>
        <div class="tools">
          @if (isAdmin) {
            <a class="btn" routerLink="import">Import from Excel</a>
          }
          @if (canEdit) {
            <button type="button" class="btn primary" (click)="addDlg.open()">Add student</button>
          }
        </div>
      </header>
      <div class="filters" role="search" aria-label="Filter students">
        <div class="field grow">
          <label for="q">Search</label>
          <input
            id="q"
            type="search"
            placeholder="Name or email"
            [value]="query()"
            (input)="query.set($any($event.target).value)"
          />
        </div>
        <div class="field">
          <label for="f-status">Status</label>
          <select id="f-status" [value]="status()" (change)="status.set($any($event.target).value)">
            <option value="">Any</option>
            <option value="ACTIVE">Active</option>
            <option value="PAUSED">Paused</option>
            <option value="EXITED">Left</option>
          </select>
        </div>
        <div class="field">
          <label for="f-plan">Plan</label>
          <select id="f-plan" [value]="plan()" (change)="plan.set($any($event.target).value)">
            <option value="">Any</option>
            <option value="PREMIUM">Premium</option>
            <option value="STANDARD">Standard</option>
            <option value="BASIC">Basic</option>
            <option value="NONE">No subscription</option>
          </select>
        </div>
        <div class="field">
          <label for="f-teacher">Teacher</label>
          <select
            id="f-teacher"
            [value]="teacher()"
            (change)="teacher.set($any($event.target).value)"
          >
            <option value="">Any</option>
            @for (t of teacherNames(); track t) {
              <option [value]="t">{{ t }}</option>
            }
          </select>
        </div>
      </div>
      <section class="card flush">
        <div class="table-wrap">
          <table class="data" style="min-width: 720px">
            <thead>
              <tr>
                <th>Student</th>
                <th>Plan</th>
                <th>Teacher</th>
                <th>Status</th>
                <th class="act"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              @for (s of filtered(); track s.id) {
                <tr>
                  <td>
                    <a [routerLink]="[s.id]"
                      ><strong>{{ s.fullName }}</strong></a
                    >
                    <span class="sub">{{ s.email }} · {{ city(s.timezone) }}</span>
                  </td>
                  <td>
                    {{ tier(s.plan) }}
                    @if (s.lessonsPerWeek) {
                      · {{ s.lessonsPerWeek }}/week
                    }
                  </td>
                  <td>{{ s.teacher ?? '—' }}</td>
                  <td>
                    <span
                      class="chip"
                      [class.ok]="s.status === 'ACTIVE'"
                      [class.warn]="s.status === 'PAUSED'"
                      >{{ s.status.toLowerCase() }}</span
                    >
                  </td>
                  <td class="act">
                    <app-person-actions
                      [person]="{
                        kind: 'student',
                        id: s.id,
                        userId: s.userId,
                        name: s.fullName,
                        subscriptionId: s.subscriptionId,
                      }"
                      (changed)="students.reload()"
                    />
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="5" class="empty">
                    {{ students.isLoading() ? 'Loading…' : 'No students found.' }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
      <app-page-log title="Activity on students" actions="student." />
    </div>
    <app-add-student-dialog #addDlg (added)="students.reload()" />
  `,
})
export class AdminStudents {
  protected readonly isAdmin = inject(AuthService).user()?.role === 'ADMIN';
  /** staff accounts may be limited to other areas */
  protected readonly canEdit = inject(AuthService).can('students');
  protected readonly students = httpResource<StudentRow[]>(() => '/api/students', {
    defaultValue: [],
  });
  protected readonly query = signal('');
  protected readonly status = signal('');
  protected readonly plan = signal('');
  protected readonly teacher = signal('');
  protected readonly teacherNames = computed(() =>
    [
      ...new Set(
        this.students
          .value()
          .map((s) => s.teacher)
          .filter((t): t is string => !!t),
      ),
    ].sort(),
  );
  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const plan = this.plan();
    return this.students
      .value()
      .filter(
        (s) => !q || s.fullName.toLowerCase().includes(q) || s.email.toLowerCase().includes(q),
      )
      .filter((s) => !this.status() || s.status === this.status())
      .filter((s) => !plan || (plan === 'NONE' ? !s.plan : s.plan === plan))
      .filter((s) => !this.teacher() || s.teacher === this.teacher());
  });
  protected readonly city = city;
  protected readonly tier = tierLabel;
}
