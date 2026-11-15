import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { day, time, typeLabel } from '../../core/format';
import type { Lesson } from '../../core/models';
import { LessonStatus } from '../../shared/lesson-status';

const PAGE = 20;

/** Past lessons, newest first, with what the teacher wrote and the homework. */
@Component({
  selector: 'app-student-lessons',
  imports: [RouterLink, LessonStatus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <h1>Lessons &amp; homework</h1>
          <p>Your past lessons, newest first · {{ tz }} time</p>
        </div>
        <div class="filter" role="group" aria-label="Show">
          <button
            type="button"
            class="btn small"
            [class.on]="!onlyHomework()"
            [attr.aria-pressed]="!onlyHomework()"
            (click)="onlyHomework.set(false)"
          >
            All lessons
          </button>
          <button
            type="button"
            class="btn small"
            [class.on]="onlyHomework()"
            [attr.aria-pressed]="onlyHomework()"
            (click)="onlyHomework.set(true)"
          >
            With homework
          </button>
        </div>
      </header>

      @if (error()) {
        <p class="notice danger" role="alert">{{ error() }}</p>
      }

      <div class="list">
        @for (l of shown(); track l.id) {
          <article class="card lesson" [attr.aria-labelledby]="'when-' + l.id">
            <div class="top">
              <div>
                <h2 [id]="'when-' + l.id">
                  <a [routerLink]="['/student/lessons', l.id]"
                    >{{ d(l.startsAt) }} · {{ t(l.startsAt) }}</a
                  >
                </h2>
                <span class="muted small"
                  >{{ l.teacher.name }} · {{ l.curriculum }} · {{ type(l) }}</span
                >
              </div>
              <app-lesson-status [lesson]="l" />
            </div>
            @if (held(l) || l.notes || l.homeworkTitle) {
              <div class="body">
                <div>
                  <h3>What you covered</h3>
                  <p class="pre">{{ l.notes || 'Your teacher has not added notes yet.' }}</p>
                </div>
                @if (l.homeworkTitle || l.homeworkBody) {
                  <div class="hw">
                    <h3>Homework</h3>
                    <strong>{{ l.homeworkTitle }}</strong>
                    @if (l.homeworkBody) {
                      <p class="pre">{{ l.homeworkBody }}</p>
                    }
                    <a class="hw-state" [routerLink]="['/student/lessons', l.id]">{{
                      l.homeworkCheckedAt
                        ? 'Checked: read the reply'
                        : l.homeworkSentAt
                          ? 'Sent: waiting for a reply'
                          : 'Send your answer'
                    }}</a>
                  </div>
                }
              </div>
            }
          </article>
        } @empty {
          @if (!loading()) {
            <p class="card empty">
              {{
                onlyHomework()
                  ? 'No homework yet.'
                  : 'No past lessons yet. They show up here after your first lesson.'
              }}
            </p>
          }
        }
      </div>

      @if (loading()) {
        <p class="muted" role="status">Loading…</p>
      } @else if (hasMore()) {
        <div>
          <button type="button" class="btn" (click)="loadMore()">Show earlier lessons</button>
        </div>
      }
    </div>
  `,
  styles: `
    .filter {
      display: flex;
      gap: 6px;
    }
    .filter .on {
      background: var(--primary-tint);
      border-color: var(--primary);
      color: var(--primary);
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: 14px;
      max-width: 860px;
    }
    .lesson {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .top {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px 16px;
    }
    .top > div {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    h2 {
      font-size: 16px;
      margin: 0;
    }
    h2 a {
      color: inherit;
      text-decoration: none;
    }
    h2 a:hover {
      text-decoration: underline;
    }
    h3 {
      font-size: 13px;
      margin: 0 0 4px;
      color: var(--muted);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .body {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 14px;
      padding-top: 14px;
      border-top: 1px solid var(--divider);
    }
    .hw {
      background: var(--surface-muted);
      border-radius: 10px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .pre {
      white-space: pre-line;
      margin: 0;
    }
    .small {
      font-size: 13px;
    }
  `,
})
export class StudentLessons {
  private readonly api = inject(ApiService);
  protected readonly tz = inject(AuthService).user()?.timezone ?? 'UTC';
  private readonly lessons = signal<Lesson[]>([]);
  protected readonly loading = signal(true);
  protected readonly hasMore = signal(false);
  protected readonly error = signal('');
  protected readonly onlyHomework = signal(false);

  protected readonly shown = computed(() =>
    this.onlyHomework()
      ? this.lessons().filter((l) => l.homeworkTitle || l.homeworkBody)
      : this.lessons(),
  );

  constructor() {
    void this.load(new Date().toISOString());
  }

  protected loadMore() {
    const oldest = this.lessons().at(-1);
    if (oldest) void this.load(oldest.startsAt);
  }

  private async load(to: string) {
    this.loading.set(true);
    this.error.set('');
    try {
      const page = await this.api.lessonHistory(to, PAGE);
      this.lessons.update((all) => [...all, ...page]);
      this.hasMore.set(page.length === PAGE);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected d(iso: string) {
    return day(iso, this.tz);
  }
  protected t(iso: string) {
    return time(iso, this.tz);
  }
  protected type(l: Lesson) {
    return typeLabel(l.type, l.extraReason);
  }

  /** Held with the student there: notes are expected. */
  protected held(l: Lesson) {
    return l.status === 'COMPLETED' && l.attendance !== 'TEACHER_ONLY' && l.attendance !== 'NONE';
  }
}
