import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../core/api.service';
import { ACADEMY_TZ, dayTime, time } from '../core/format';
import type { Lesson } from '../core/models';
import { LessonActionDialog, type LessonTab } from './lesson-action-dialog';
import { ResetPasswordDialog } from './reset-password-dialog';

export interface PersonRef {
  kind: 'student' | 'teacher';
  /** student or teacher id */
  id: string;
  userId: string;
  name: string;
  /** students: the active subscription, if any */
  subscriptionId?: string | null;
}

interface Item {
  label: string;
  run: () => void;
}

let next = 0;

/**
 * The "Actions" button on a student or teacher row: profile, calendar,
 * lessons (book, add, reschedule, cancel, transfer) and reset password.
 * Reschedule and cancel first ask which upcoming lesson.
 */
@Component({
  selector: 'app-person-actions',
  imports: [LessonActionDialog, ResetPasswordDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      #btn
      type="button"
      class="btn small"
      aria-haspopup="menu"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="'Actions for ' + person().name"
      (click)="toggle()"
    >
      Actions ▾
    </button>
    @if (open()) {
      <div class="menu" role="menu" [style.top.px]="pos().top" [style.left.px]="pos().left">
        @for (item of items(); track item.label) {
          <button type="button" role="menuitem" (click)="pick(item)">{{ item.label }}</button>
        }
      </div>
    }

    <dialog
      #pickDlg
      class="pick"
      [attr.aria-labelledby]="uid + '-title'"
      (close)="picking.set(null)"
    >
      <div class="pick-head">
        <h2 [id]="uid + '-title'">
          {{ picking() === 'cancel' ? 'Cancel' : 'Reschedule' }} which lesson?
        </h2>
        <button type="button" class="btn small" aria-label="Close" (click)="pickDlg.close()">
          ✕
        </button>
      </div>
      <p class="muted small">{{ person().name }} · upcoming lessons</p>
      @if (loading()) {
        <p class="muted">Loading…</p>
      } @else if (error()) {
        <p class="notice danger" role="alert">{{ error() }}</p>
      } @else {
        <ul class="lessons">
          @for (l of upcoming(); track l.id) {
            <li>
              <button type="button" (click)="choose(l)">
                <strong>{{ day(l) }}</strong>
                <span class="sub"
                  >{{ cairo(l.startsAt) }} Cairo ·
                  {{ person().kind === 'student' ? l.teacher.name : l.student.name }}</span
                >
              </button>
            </li>
          } @empty {
            <li class="muted">No upcoming lessons.</li>
          }
        </ul>
      }
    </dialog>

    <app-lesson-action-dialog
      [lesson]="lesson()"
      [startTab]="tab()"
      (closed)="lessonClosed($event)"
    />
    <app-reset-password-dialog [person]="resetFor()" (closed)="resetFor.set(null)" />
  `,
  styles: `
    :host {
      display: inline-block;
    }
    .menu {
      position: fixed;
      z-index: 50;
      min-width: 220px;
      padding: 6px;
      background: var(--surface, #fff);
      border: 1px solid var(--border);
      border-radius: 10px;
      box-shadow: 0 12px 28px rgb(0 0 0 / 16%);
      display: flex;
      flex-direction: column;
    }
    .menu button {
      text-align: left;
      border: 0;
      background: none;
      font: inherit;
      font-size: 14px;
      color: var(--ink);
      padding: 8px 10px;
      border-radius: 6px;
      cursor: pointer;
      white-space: nowrap;
    }
    .menu button:hover,
    .menu button:focus-visible {
      background: var(--primary-tint);
      outline: none;
    }
    .pick {
      width: min(440px, calc(100vw - 32px));
      border: 0;
      border-radius: 14px;
      padding: 20px;
    }
    .pick::backdrop {
      background: rgb(0 0 0 / 35%);
    }
    .pick-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }
    .pick h2 {
      margin: 0;
      font-size: 18px;
    }
    .lessons {
      list-style: none;
      margin: 12px 0 0;
      padding: 0;
      display: grid;
      gap: 6px;
      max-height: 50vh;
      overflow-y: auto;
    }
    .lessons button {
      width: 100%;
      text-align: left;
      padding: 10px 12px;
      border: 1px solid var(--border-strong);
      border-radius: 10px;
      background: none;
      font: inherit;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .lessons button:hover {
      border-color: var(--primary);
      background: var(--primary-tint);
    }
    .sub {
      font-size: 13px;
      color: var(--muted);
    }
  `,
})
export class PersonActions {
  protected readonly uid = `pa${++next}`;
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly btn = viewChild.required<ElementRef<HTMLButtonElement>>('btn');
  private readonly pickDlg = viewChild.required<ElementRef<HTMLDialogElement>>('pickDlg');

  readonly person = input.required<PersonRef>();
  /** after a lesson changed */
  readonly changed = output<void>();

  protected readonly open = signal(false);
  protected readonly pos = signal({ top: 0, left: 0 });
  protected readonly picking = signal<LessonTab | null>(null);
  protected readonly tab = signal<LessonTab>('reschedule');
  protected readonly upcoming = signal<Lesson[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly lesson = signal<Lesson | null>(null);
  protected readonly resetFor = signal<{ userId: string; name: string } | null>(null);

  protected readonly items = computed<Item[]>(() => {
    const p = this.person();
    const base = p.kind === 'student' ? '/admin/students' : '/admin/teachers';
    const list: Item[] = [
      { label: 'View profile', run: () => this.go([base, p.id]) },
      { label: 'View calendar', run: () => this.go([base, p.id, 'calendar']) },
    ];
    if (p.kind === 'student') {
      list.push({ label: 'Add a lesson', run: () => this.go([base, p.id, 'add-lesson']) });
    } else {
      list.push({ label: 'Weekly hours', run: () => this.go([base, p.id, 'availability']) });
    }
    // Lessons are moved or cancelled from the student's side only.
    if (p.kind === 'student')
      list.push(
        { label: 'Reschedule a lesson', run: () => this.startPick('reschedule') },
        { label: 'Cancel a lesson', run: () => this.startPick('cancel') },
      );
    if (p.kind === 'student' && p.subscriptionId)
      list.push({
        label: 'Transfer',
        run: () => this.go([base, p.id, 'transfer']),
      });
    list.push({
      label: 'Reset password',
      run: () => this.resetFor.set({ userId: p.userId, name: p.name }),
    });
    return list;
  });

  protected toggle() {
    if (this.open()) {
      this.open.set(false);
      return;
    }
    const r = this.btn().nativeElement.getBoundingClientRect();
    const width = 230;
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    const below = r.bottom + 4;
    const height = 44 * this.items().length + 12;
    const top = below + height > window.innerHeight ? Math.max(8, r.top - height - 4) : below;
    this.pos.set({ top, left });
    this.open.set(true);
  }

  protected pick(item: Item) {
    this.open.set(false);
    item.run();
  }

  private go(path: string[], queryParams?: Record<string, string>) {
    void this.router.navigate(path, queryParams ? { queryParams } : undefined);
  }

  private async startPick(tab: LessonTab) {
    const p = this.person();
    this.picking.set(tab);
    this.tab.set(tab);
    this.error.set('');
    this.loading.set(true);
    this.pickDlg().nativeElement.showModal();
    try {
      const params: Record<string, string> = {
        from: new Date().toISOString(),
        status: 'SCHEDULED',
        limit: '30',
        [p.kind === 'student' ? 'studentId' : 'teacherId']: p.id,
      };
      this.upcoming.set(await firstValueFrom(this.http.get<Lesson[]>('/api/lessons', { params })));
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected choose(l: Lesson) {
    this.pickDlg().nativeElement.close();
    this.lesson.set(l);
  }

  protected lessonClosed(changed: boolean) {
    this.lesson.set(null);
    if (changed) this.changed.emit();
  }

  protected day(l: Lesson) {
    return `${dayTime(l.startsAt, l.student.timezone)} (${l.student.timezone.split('/').pop()?.replace('_', ' ')})`;
  }
  protected cairo(iso: string) {
    return time(iso, ACADEMY_TZ);
  }

  @HostListener('document:mousedown', ['$event'])
  protected outside(e: MouseEvent) {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  protected escape() {
    this.open.set(false);
  }

  @HostListener('window:scroll')
  @HostListener('window:resize')
  protected moved() {
    this.open.set(false);
  }
}
