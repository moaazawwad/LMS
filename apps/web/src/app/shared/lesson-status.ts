import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Lesson } from '../core/models';

/** The status chip used in every lesson list. */
@Component({
  selector: 'app-lesson-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="chip" [class]="view().cls">{{ view().label }}</span>`,
})
export class LessonStatus {
  readonly lesson = input.required<
    Pick<
      Lesson,
      | 'status'
      | 'cancelReason'
      | 'countedAsTaken'
      | 'missed'
      | 'canEnter'
      | 'startsAt'
      | 'durationMin'
    > &
      Partial<Pick<Lesson, 'attendance' | 'teacherJoinedAt' | 'studentJoinedAt' | 'makeupOwed'>>
  >();

  protected readonly view = computed(() => {
    const l = this.lesson();
    const start = new Date(l.startsAt).getTime();
    const now = Date.now();
    switch (l.status) {
      case 'COMPLETED':
        if (l.attendance === 'TEACHER_ONLY') return { cls: 'chip warn', label: 'Student absent' };
        if (l.attendance === 'NONE') return { cls: 'chip warn', label: 'Nobody came' };
        return { cls: 'chip', label: 'Completed' };
      case 'RESCHEDULED':
        return { cls: 'chip warn', label: 'Moved' };
      case 'CANCELLED': {
        const who = l.cancelReason
          ? l.cancelReason.replace('BY_', '').replace('UNPAID', 'unpaid').toLowerCase()
          : '';
        if (l.makeupOwed) return { cls: 'chip danger', label: 'Cancelled · makeup owed' };
        return {
          cls: 'chip danger',
          label: l.countedAsTaken ? 'Cancelled · counted' : `Cancelled · ${who}`,
        };
      }
      default:
        if (l.missed) {
          // Ended without both entering. Settled a few minutes after the end; until then use the presses.
          const who =
            l.attendance ??
            (l.teacherJoinedAt ? 'TEACHER_ONLY' : l.studentJoinedAt ? 'STUDENT_ONLY' : 'NONE');
          if (who === 'STUDENT_ONLY') return { cls: 'chip warn', label: "Teacher didn't enter" };
          if (who === 'TEACHER_ONLY') return { cls: 'chip warn', label: 'Student absent' };
          return { cls: 'chip warn', label: 'Nobody entered' };
        }
        if (now >= start && now <= start + l.durationMin * 60_000)
          return { cls: 'chip live', label: 'Live' };
        if (start - now < 60 * 60_000 && start > now)
          return { cls: 'chip info', label: `Starts in ${Math.ceil((start - now) / 60_000)} min` };
        return { cls: 'chip info', label: 'Scheduled' };
    }
  });
}
