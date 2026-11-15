import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Lesson } from '../../core/models';
import { LessonActionDialog } from '../../shared/lesson-action-dialog';
import { ScheduleCheckPanel } from './schedule-check';

/** The schedule check on its own page: upcoming lessons that need attention. */
@Component({
  selector: 'app-admin-schedule-page',
  imports: [RouterLink, ScheduleCheckPanel, LessonActionDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <nav aria-label="Breadcrumb" class="muted">
        <a routerLink="/admin/today">Today</a> / Schedule check
      </nav>
      <header class="page-head">
        <div>
          <h1>Schedule check</h1>
          <p>
            The next six weeks: lessons outside the teacher's hours or clashing, and clock changes
            in Egypt and the students' countries.
          </p>
        </div>
      </header>
      @if (check.value(); as c) {
        @if (!c.problems.length) {
          <p class="notice ok" role="status"><span>Nothing needs attention.</span></p>
        }
      }
      <app-schedule-check (change)="editing.set($event)" />
    </div>
    <app-lesson-action-dialog [lesson]="editing()" (closed)="closed($event)" />
  `,
})
export class AdminSchedulePage {
  protected readonly check = httpResource<{ problems: unknown[] }>(
    () => '/api/lessons/schedule-check',
  );
  protected readonly editing = signal<Lesson | null>(null);
  private readonly panel = viewChild(ScheduleCheckPanel);
  protected closed(changed: boolean) {
    this.editing.set(null);
    if (changed) {
      this.check.reload();
      this.panel()?.reload();
    }
  }
}
