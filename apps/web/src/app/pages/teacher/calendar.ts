import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ACADEMY_TZ } from '../../core/format';
import { MonthCalendar } from '../../shared/month-calendar';

/** The teacher's month on Cairo time; each lesson opens its notes page. */
@Component({
  selector: 'app-teacher-calendar',
  imports: [MonthCalendar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-month-calendar
    [timezone]="tz"
    subtitle="Cairo time"
    linkBase="/teacher/lessons"
    [showStudent]="true"
  />`,
})
export class TeacherCalendar {
  protected readonly tz = ACADEMY_TZ;
}
