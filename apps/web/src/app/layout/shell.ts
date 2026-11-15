import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import type { StaffArea } from '../core/models';
import { BRAND, BrandMark } from '../shared/brand';
import { Bell } from '../shared/bell';
import { QuickFind } from '../shared/quick-find';
import { Icon } from '../shared/icon';

interface NavItem {
  label: string;
  path: string;
  icon: string;
  adminOnly?: boolean;
  /** staff accounts see it only with this area */
  area?: StaffArea;
  /** shows the number of open requests */
  badge?: boolean;
}

const NAV: Record<'admin' | 'teacher' | 'student', NavItem[]> = {
  admin: [
    { label: 'Today', path: '/admin/today', icon: 'today' },
    { label: 'Students', path: '/admin/students', icon: 'students' },
    { label: 'Teachers', path: '/admin/teachers', icon: 'teachers' },
    { label: 'Lessons', path: '/admin/lessons', icon: 'calendar', area: 'lessons' },
    { label: 'Requests', path: '/admin/requests', icon: 'inbox', badge: true, area: 'lessons' },
    { label: 'Invoices', path: '/admin/invoices', icon: 'invoices', area: 'billing' },
    { label: 'Reports', path: '/admin/reports', icon: 'chart', area: 'billing' },
    { label: 'Curricula & plans', path: '/admin/catalog', icon: 'book', area: 'catalog' },
    { label: 'Staff & roles', path: '/admin/staff', icon: 'shield', adminOnly: true },
    { label: 'Settings', path: '/admin/settings', icon: 'settings' },
  ],
  teacher: [
    { label: 'Today', path: '/teacher/today', icon: 'today' },
    { label: 'Calendar', path: '/teacher/calendar', icon: 'calendar' },
    { label: 'Past lessons', path: '/teacher/history', icon: 'book' },
    { label: 'Books', path: '/teacher/books', icon: 'book' },
    { label: 'Settings', path: '/teacher/settings', icon: 'settings' },
  ],
  student: [
    { label: 'Home', path: '/student/home', icon: 'home' },
    { label: 'Lessons & homework', path: '/student/lessons', icon: 'book' },
    { label: 'Calendar', path: '/student/calendar', icon: 'calendar' },
    { label: 'Books', path: '/student/books', icon: 'book' },
    { label: 'Invoices', path: '/student/invoices', icon: 'invoices' },
    { label: 'Settings', path: '/student/settings', icon: 'settings' },
  ],
};

/** Sidebar + page area shared by the three dashboards. */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, BrandMark, QuickFind, Bell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="shell">
      <aside class="side">
        <div class="brand">
          <app-brand-mark [size]="36" />
          <span class="names">
            <strong>{{ brand.short }}</strong>
            <span>Academy · {{ roleLabel() }}</span>
          </span>
          <app-bell class="bell" />
        </div>
        @if (isStaff()) {
          <app-quick-find
            class="find"
            [students]="auth.can('students')"
            [teachers]="auth.can('teachers')"
          />
        }
        <nav [attr.aria-label]="roleLabel()">
          @for (item of items(); track item.path) {
            <a
              #link
              [routerLink]="item.path"
              routerLinkActive="active"
              ariaCurrentWhenActive="page"
              (isActiveChange)="$event && reveal(link)"
            >
              <app-icon [name]="item.icon" />
              {{ item.label }}
              @if (item.badge && openRequests()) {
                <span class="badge">{{ openRequests() }}<span class="sr-only"> open</span></span>
              }
            </a>
          }
        </nav>
        <div class="me">
          <span>{{ auth.user()?.fullName }}</span>
          <button type="button" class="btn small" (click)="auth.logout()">
            <app-icon name="logout" [size]="16" /> Sign out
          </button>
        </div>
      </aside>
      <main class="content">
        <router-outlet />
      </main>
    </div>
  `,
  styles: `
    .shell {
      min-height: 100vh;
      display: flex;
      flex-wrap: wrap;
    }
    .side {
      flex: 1 1 232px;
      background: var(--surface);
      border-right: 1px solid var(--border);
      padding: 20px 14px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 6px;
    }
    .bell {
      margin-left: auto;
    }
    .find {
      display: block;
      margin: 14px 0 4px;
    }
    .names {
      display: flex;
      flex-direction: column;
    }
    .names strong {
      font-size: 16px;
      font-weight: 800;
      letter-spacing: -0.01em;
    }
    .names span {
      font-size: 12px;
      color: var(--muted);
    }
    nav {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    nav a {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 44px;
      padding: 0 12px;
      border-radius: 8px;
      color: var(--ink-2);
      font-weight: 500;
      text-decoration: none;
    }
    nav a.active {
      background: var(--primary-tint);
      color: var(--primary);
      font-weight: 600;
    }
    .badge {
      margin-left: auto;
      min-width: 22px;
      height: 22px;
      padding: 0 7px;
      border-radius: 11px;
      background: var(--primary);
      color: #fff;
      font-size: 12px;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .me {
      margin-top: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 0 6px;
      font-size: 13px;
      color: var(--muted);
    }
    .content {
      flex: 999 1 560px;
      min-width: 0;
      padding: 28px 32px 40px;
    }
    @media (max-width: 640px) {
      /* Phone: brand + sign out on one row, the menu as a strip that scrolls sideways. */
      .side {
        flex-basis: 100%;
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 10px;
        padding: 12px 16px 8px;
        border-right: 0;
        border-bottom: 1px solid var(--border);
      }
      .brand {
        padding: 0;
      }
      .find {
        grid-column: 1 / -1;
      }
      .me {
        grid-column: 2;
        grid-row: 1;
        margin: 0;
        padding: 0;
        justify-content: center;
      }
      .me span {
        display: none;
      }
      nav {
        grid-column: 1 / -1;
        flex-direction: row;
        gap: 4px;
        overflow-x: auto;
        margin: 0 -16px;
        padding: 0 16px 4px;
        scrollbar-width: none;
      }
      nav a {
        flex: none;
        min-height: 40px;
        white-space: nowrap;
      }
      .content {
        padding: 20px 16px 32px;
      }
    }
  `,
})
export class Shell {
  protected readonly brand = BRAND;
  protected readonly isStaff = computed(() => {
    const role = this.auth.user()?.role;
    return role === 'ADMIN' || role === 'STAFF';
  });
  protected readonly auth = inject(AuthService);
  private readonly area = computed(() => {
    const role = this.auth.user()?.role;
    return role === 'TEACHER' ? 'teacher' : role === 'STUDENT' ? 'student' : 'admin';
  });
  protected readonly items = computed(() =>
    NAV[this.area()].filter(
      (i) =>
        (!i.adminOnly || this.auth.user()?.role === 'ADMIN') && (!i.area || this.auth.can(i.area)),
    ),
  );
  protected readonly roleLabel = computed(
    () => ({ admin: 'Admin', teacher: 'Teacher', student: 'Student' })[this.area()],
  );

  /** Open requests for the menu badge (staff only), refreshed on every page change. */
  private readonly summary = httpResource<{ open: number }>(() =>
    this.area() === 'admin' ? '/api/requests/summary' : undefined,
  );
  protected readonly openRequests = computed(() => this.summary.value()?.open ?? 0);

  constructor() {
    // An admin may have changed what this staff account covers.
    if (this.auth.user()?.role === 'STAFF') void this.auth.refresh();
    const sub = inject(Router).events.subscribe((e) => {
      if (e instanceof NavigationEnd && this.area() === 'admin') this.summary.reload();
    });
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }

  /** On a phone the menu scrolls sideways: keep the current page's item in view. */
  protected reveal(link: HTMLElement) {
    setTimeout(() => link.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }
}
