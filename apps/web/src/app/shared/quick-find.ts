import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import type { StudentRow, TeacherRow } from '../core/models';

interface Hit {
  kind: 'Student' | 'Teacher';
  id: string;
  name: string;
  email: string;
  extra: string;
  link: string[];
}

/**
 * "Find a person": type part of a name or email, pick a student or teacher,
 * go to their page (the student's page has their teacher's meeting link).
 * Ctrl+K or / focuses it from anywhere.
 */
@Component({
  selector: 'app-quick-find',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="qf">
      <label class="sr-only" for="quick-find">Find a person</label>
      <input
        id="quick-find"
        type="search"
        autocomplete="off"
        placeholder="Find a person…  Ctrl K"
        role="combobox"
        aria-controls="quick-find-list"
        [attr.aria-expanded]="open()"
        [attr.aria-activedescendant]="open() && hits().length ? 'qf-' + active() : null"
        [value]="text()"
        (input)="type($any($event.target).value)"
        (focus)="open.set(!!text())"
        (keydown)="key($event)"
      />
      @if (open() && text().trim()) {
        <ul id="quick-find-list" role="listbox" class="list" aria-label="People found">
          @for (h of hits(); track h.kind + h.id; let i = $index) {
            <li
              [id]="'qf-' + i"
              role="option"
              [attr.aria-selected]="i === active()"
              [class.on]="i === active()"
              (mousedown)="$event.preventDefault()"
              (click)="go(h)"
            >
              <span class="kind">{{ h.kind }}</span>
              <strong>{{ h.name }}</strong>
              <span class="sub">{{ h.extra || h.email }}</span>
            </li>
          } @empty {
            <li class="none" role="option" aria-disabled="true">Nobody matches.</li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    .qf {
      position: relative;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      min-height: 38px;
      padding: 0 10px;
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      font: inherit;
      font-size: 13px;
      background: var(--surface, #fff);
      color: var(--ink);
    }
    .list {
      position: absolute;
      z-index: 40;
      top: calc(100% + 4px);
      left: 0;
      width: max(100%, 300px);
      max-height: 360px;
      overflow-y: auto;
      margin: 0;
      padding: 4px;
      list-style: none;
      background: var(--surface, #fff);
      border: 1px solid var(--border);
      border-radius: 10px;
      box-shadow: 0 12px 28px rgb(0 0 0 / 14%);
    }
    li {
      display: grid;
      grid-template-columns: 62px 1fr;
      gap: 0 8px;
      padding: 8px 10px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
    }
    li.on,
    li:hover {
      background: var(--primary-tint);
    }
    li .kind {
      grid-row: span 2;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
      padding-top: 3px;
    }
    li .sub {
      font-size: 12px;
      color: var(--muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    li.none {
      display: block;
      color: var(--muted);
      cursor: default;
    }
  `,
})
export class QuickFind {
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  /** which lists this person may open */
  readonly students = input(true);
  readonly teachers = input(true);

  protected readonly text = signal('');
  protected readonly open = signal(false);
  protected readonly active = signal(0);
  /** loaded the first time someone types */
  private readonly wanted = signal(false);

  private readonly studentList = httpResource<StudentRow[]>(
    () => (this.wanted() && this.students() ? '/api/students' : undefined),
    { defaultValue: [] },
  );
  private readonly teacherList = httpResource<TeacherRow[]>(
    () => (this.wanted() && this.teachers() ? '/api/teachers' : undefined),
    { defaultValue: [] },
  );

  protected readonly hits = computed<Hit[]>(() => {
    const q = this.text().trim().toLowerCase();
    if (!q) return [];
    const match = (...fields: (string | null)[]) =>
      fields.some((f) => f?.toLowerCase().includes(q));
    const students: Hit[] = (this.studentList.error() ? [] : this.studentList.value())
      .filter((s) => match(s.fullName, s.email))
      .map((s) => ({
        kind: 'Student',
        id: s.id,
        name: s.fullName,
        email: s.email,
        extra: s.teacher ? `with ${s.teacher}` : '',
        link: ['/admin/students', s.id],
      }));
    const teachers: Hit[] = (this.teacherList.error() ? [] : this.teacherList.value())
      .filter((t) => match(t.fullName, t.email))
      .map((t) => ({
        kind: 'Teacher',
        id: t.id,
        name: t.fullName,
        email: t.email,
        extra: t.email,
        link: ['/admin/teachers', t.id],
      }));
    return [...students, ...teachers].slice(0, 12);
  });

  protected type(value: string) {
    this.wanted.set(true);
    this.text.set(value);
    this.active.set(0);
    this.open.set(!!value.trim());
  }

  protected key(e: KeyboardEvent) {
    const n = this.hits().length;
    if (e.key === 'ArrowDown' && n) {
      e.preventDefault();
      this.open.set(true);
      this.active.update((i) => (i + 1) % n);
    } else if (e.key === 'ArrowUp' && n) {
      e.preventDefault();
      this.active.update((i) => (i - 1 + n) % n);
    } else if (e.key === 'Enter' && n) {
      e.preventDefault();
      this.go(this.hits()[this.active()]);
    } else if (e.key === 'Escape') {
      this.open.set(false);
    }
  }

  protected go(h: Hit) {
    this.open.set(false);
    this.text.set('');
    (this.host.nativeElement.querySelector('input') as HTMLInputElement | null)?.blur();
    void this.router.navigate(h.link);
  }

  @HostListener('document:keydown', ['$event'])
  protected shortcut(e: KeyboardEvent) {
    const typing = (e.target as HTMLElement | null)?.closest(
      'input, textarea, select, [contenteditable]',
    );
    if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
      e.preventDefault();
      (this.host.nativeElement.querySelector('input') as HTMLInputElement | null)?.focus();
    }
  }

  @HostListener('document:mousedown', ['$event'])
  protected outside(e: MouseEvent) {
    if (!this.host.nativeElement.contains(e.target as Node)) this.open.set(false);
  }
}
