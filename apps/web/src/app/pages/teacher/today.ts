import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import {
  ACADEMY_TZ,
  addDays,
  city,
  day,
  localDate,
  shiftText,
  time,
  typeLabel,
} from '../../core/format';
import type { Lesson } from '../../core/models';
import { Icon } from '../../shared/icon';
import { LessonStatus } from '../../shared/lesson-status';
import { needsNotes } from './history';
import { MyRequests } from '../../shared/my-requests';

@Component({
  selector: 'app-teacher-today',
  imports: [RouterLink, Icon, LessonStatus, MyRequests],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <h1>Today, {{ firstName() }}</h1>
          <p>{{ todayLabel }} · Cairo time</p>
        </div>
      </header>
      @if (anyMoved()) {
        <p class="notice info" role="status">
          <span
            >Clocks change soon. Lessons marked “clock change” are at a new Cairo time; your
            students keep their usual time.</span
          >
        </p>
      }

      <div class="cols">
        <div class="main">
          @if (next(); as n) {
            <section class="card next" aria-labelledby="next-title">
              <div class="row">
                <div>
                  <span id="next-title" class="eyebrow">Next lesson</span>
                  <span class="big num">{{ cairo(n.startsAt) }}</span>
                  <span class="muted"
                    >{{ local(n) }} for the student · {{ n.durationMin }} min</span
                  >
                  @if (n.clockShiftMin) {
                    <span class="chip warn moved">{{ moved(n) }}</span>
                  }
                </div>
                <div class="enter">
                  <button
                    type="button"
                    class="btn primary big-btn"
                    [disabled]="!n.canEnter"
                    (click)="enter(n)"
                  >
                    <app-icon name="video" [size]="20" [stroke]="2" /> Enter class
                  </button>
                  <span class="muted small">{{
                    n.canEnter ? 'Counts as your attendance' : 'Opens 10 minutes before'
                  }}</span>
                </div>
              </div>
              <div class="who">
                <strong>{{ n.student.name }}</strong>
                <span class="muted">{{ n.curriculum }} · {{ type(n) }}</span>
              </div>
              <div class="actions">
                <a class="btn" [routerLink]="['/teacher/lessons', n.id]">Notes &amp; homework</a>
                <a
                  class="btn danger"
                  [routerLink]="['/teacher/ask', n.id]"
                  [queryParams]="{ kind: 'cancel' }"
                  >Ask to cancel</a
                >
              </div>
            </section>
          } @else {
            <section class="card"><h2>No more lessons today</h2></section>
          }

          <section class="card flush">
            <div class="card-head"><h2>Coming up</h2></div>
            @for (g of upcoming(); track g.day) {
              <div class="dayhead">{{ g.label }}</div>
              @for (l of g.lessons; track l.id) {
                <div class="list-row">
                  <span class="t num">{{ cairo(l.startsAt) }}</span>
                  <span class="grow"
                    ><a [routerLink]="['/teacher/lessons', l.id]">{{ l.student.name }}</a
                    >&ngsp;<span class="muted"
                      >· {{ city(l.student.timezone) }} · {{ l.curriculum }}</span
                    ></span
                  >
                  @if (l.clockShiftMin) {
                    <span class="chip warn">{{ moved(l) }}</span>
                  }
                  <span class="chip outline">{{ type(l) }}</span>
                </div>
              }
            } @empty {
              <p class="empty">Nothing scheduled this week.</p>
            }
          </section>
        </div>

        <div class="side">
          @if (homework.value().length) {
            <section class="card" aria-labelledby="hw-title">
              <h2 id="hw-title">Homework to check</h2>
              @for (l of homework.value(); track l.id) {
                <div class="done">
                  <div class="row">
                    <strong>{{ l.student.name }}</strong
                    ><span class="muted small">{{ l.homeworkTitle || 'Homework' }}</span>
                  </div>
                  <span class="muted small">Sent {{ sentText(l) }}</span>
                  <a
                    [routerLink]="['/teacher/lessons', l.id]"
                    [attr.aria-label]="'Read and reply to ' + l.student.name + ' homework'"
                    >Read and reply</a
                  >
                </div>
              }
            </section>
          }
          <app-my-requests timezone="Africa/Cairo" />
          <section class="card">
            <h2>Earlier today</h2>
            @for (l of doneToday(); track l.id) {
              <div class="done">
                <div class="row">
                  <strong>{{ cairo(l.startsAt) }} · {{ l.student.name }}</strong
                  ><app-lesson-status [lesson]="l" />
                </div>
                <a [routerLink]="['/teacher/lessons', l.id]">{{
                  l.notes ? 'Edit notes' : needsNotes(l) ? 'Add notes and homework' : 'Details'
                }}</a>
              </div>
            } @empty {
              <p class="muted">Nothing yet.</p>
            }
          </section>
        </div>
      </div>
    </div>
  `,
  styles: `
    .row {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
    }
    .row > div {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .eyebrow {
      font-size: 13px;
      font-weight: 600;
      color: var(--primary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .big {
      font-size: 40px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .enter {
      align-items: flex-end;
    }
    .big-btn {
      min-height: 52px;
      font-size: 16px;
    }
    .small {
      font-size: 13px;
    }
    .who {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 14px;
      background: var(--surface-muted);
      border: 1px solid var(--divider);
      border-radius: 12px;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .dayhead {
      padding: 10px 22px;
      background: var(--surface-muted);
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border-top: 1px solid var(--divider);
    }
    .t {
      width: 80px;
      font-weight: 600;
    }
    .grow {
      flex: 1 1 200px;
    }
    .moved {
      align-self: flex-start;
    }
    .done {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 12px 14px;
      border: 1px solid var(--divider);
      border-radius: 10px;
    }
  `,
})
export class TeacherToday {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly todayDate = localDate(new Date(), ACADEMY_TZ);
  protected readonly todayLabel = day(new Date(), ACADEMY_TZ);
  /** Answers students sent that wait for a reply, oldest first. */
  protected readonly homework = httpResource<Lesson[]>(() => '/api/lessons/homework-to-check', {
    defaultValue: [],
  });

  protected sentText(l: Lesson) {
    return l.homeworkSentAt
      ? `${day(l.homeworkSentAt, ACADEMY_TZ)} · ${time(l.homeworkSentAt, ACADEMY_TZ)}`
      : '';
  }
  protected readonly message = signal('');
  protected readonly lessons = httpResource<Lesson[]>(
    // A day either side of the window; lists below filter by the Cairo date.
    () => ({
      url: '/api/lessons',
      params: {
        from: `${addDays(this.todayDate, -1)}T00:00:00Z`,
        to: `${addDays(this.todayDate, 9)}T00:00:00Z`,
      },
    }),
    { defaultValue: [] },
  );

  protected readonly firstName = computed(() => this.auth.user()?.fullName.split(' ')[0] ?? '');
  private readonly active = computed(() =>
    this.lessons.value().filter((l) => l.status === 'SCHEDULED' || l.status === 'COMPLETED'),
  );
  protected readonly next = computed(() => {
    const now = Date.now();
    return this.active().find(
      (l) =>
        l.status === 'SCHEDULED' &&
        new Date(l.startsAt).getTime() + l.durationMin * 60_000 > now &&
        localDate(l.startsAt, ACADEMY_TZ) === this.todayDate,
    );
  });
  /** Today's lessons that have ended, attended or not, so notes can still be added. */
  protected readonly doneToday = computed(() =>
    this.active().filter(
      (l) =>
        localDate(l.startsAt, ACADEMY_TZ) === this.todayDate &&
        new Date(l.startsAt).getTime() + l.durationMin * 60_000 <= Date.now(),
    ),
  );
  protected readonly needsNotes = needsNotes;
  protected readonly anyMoved = computed(() =>
    this.active().some((l) => l.status === 'SCHEDULED' && l.clockShiftMin),
  );
  protected moved(l: Lesson) {
    return `${shiftText(l.clockShiftMin)} · clock change`;
  }
  protected readonly upcoming = computed(() => {
    const groups = new Map<string, Lesson[]>();
    const nextId = this.next()?.id;
    for (const l of this.active()) {
      if (
        l.status !== 'SCHEDULED' ||
        l.id === nextId ||
        new Date(l.startsAt).getTime() < Date.now()
      )
        continue;
      const d = localDate(l.startsAt, ACADEMY_TZ);
      groups.set(d, [...(groups.get(d) ?? []), l]);
    }
    return [...groups.entries()].map(([d, lessons]) => ({
      day: d,
      label: day(lessons[0].startsAt, ACADEMY_TZ),
      lessons,
    }));
  });

  protected cairo(iso: string) {
    return time(iso, ACADEMY_TZ);
  }
  protected local(l: Lesson) {
    return `${time(l.startsAt, l.student.timezone)} in ${city(l.student.timezone)}`;
  }
  protected type(l: Lesson) {
    return typeLabel(l.type, l.extraReason);
  }
  protected readonly city = city;

  protected async enter(l: Lesson) {
    this.message.set('');
    try {
      const { zoomLink } = await this.api.enterClass(l.id);
      if (zoomLink) window.open(zoomLink, '_blank', 'noopener');
      this.lessons.reload();
    } catch (err) {
      this.message.set(errorMessage(err));
    }
  }
}
