import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthService } from '../../core/auth.service';
import { MonthCalendar } from '../../shared/month-calendar';

/** Month view on the student's clock; each lesson opens its page. */
@Component({
  selector: 'app-student-calendar',
  imports: [MonthCalendar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-month-calendar
    [timezone]="tz"
    [subtitle]="tz + ' time'"
    linkBase="/student/lessons"
  />`,
})
export class StudentCalendar {
  protected readonly tz = inject(AuthService).user()?.timezone ?? 'UTC';
}
