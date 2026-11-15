import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ACADEMY_TZ } from '../../core/format';
import type { Lesson, StudentDetail, TeacherDetail } from '../../core/models';
import { MonthCalendar } from '../../shared/month-calendar';

/**
 * Staff view of one teacher's month (Cairo time) or one student's month
 * (their clock). A lesson opens the student's page, where it can be changed.
 */
@Component({
  selector: 'app-admin-person-calendar',
  imports: [RouterLink, MonthCalendar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (person(); as p) {
      <nav aria-label="Breadcrumb" class="muted crumbs">
        <a [routerLink]="['/admin', kind === 'teacher' ? 'teachers' : 'students']">{{
          kind === 'teacher' ? 'Teachers' : 'Students'
        }}</a>
        /
        <a [routerLink]="['/admin', kind === 'teacher' ? 'teachers' : 'students', id()]">{{
          p.name
        }}</a>
        / Calendar
      </nav>
      <app-month-calendar
        [timezone]="p.timezone"
        [subtitle]="p.name + ' · ' + (kind === 'teacher' ? 'Cairo time' : p.timezone + ' time')"
        [teacherId]="kind === 'teacher' ? id() : undefined"
        [studentId]="kind === 'student' ? id() : undefined"
        [showStudent]="kind === 'teacher'"
        [linkFor]="toStudent"
      />
    } @else {
      <p class="empty">Loading…</p>
    }
  `,
  styles: `
    .crumbs {
      display: block;
      margin-bottom: 16px;
    }
  `,
})
export class AdminPersonCalendar {
  readonly id = input.required<string>();
  protected readonly kind: 'teacher' | 'student' = inject(ActivatedRoute).snapshot.data['kind'];

  private readonly teacher = httpResource<TeacherDetail>(() =>
    this.kind === 'teacher' ? `/api/teachers/${this.id()}` : undefined,
  );
  private readonly student = httpResource<StudentDetail>(() =>
    this.kind === 'student' ? `/api/students/${this.id()}` : undefined,
  );

  protected readonly person = computed(() => {
    if (this.kind === 'teacher') {
      const t = this.teacher.value();
      return t ? { name: t.fullName, timezone: ACADEMY_TZ } : null;
    }
    const s = this.student.value();
    return s ? { name: s.fullName, timezone: s.timezone } : null;
  });

  protected readonly toStudent = (l: Lesson) => ['/admin/students', l.student.id];
}
