import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { dayTime } from '../core/format';
import type { AppNotification } from '../core/models';
import { Icon } from './icon';

/** How often the bell looks for new notices while a page stays open. */
const REFRESH_MS = 60_000;

/**
 * The bell: a person's own notices (a payment that is due, lessons on hold,
 * lessons back...). Opening one marks it read and goes to its page.
 */
@Component({
  selector: 'app-bell',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'outside($event)', '(document:keydown.escape)': 'open.set(false)' },
  template: `
    <button
      type="button"
      class="toggle"
      [attr.aria-label]="unread() ? 'Notifications, ' + unread() + ' unread' : 'Notifications'"
      [attr.aria-expanded]="open()"
      (click)="toggle()"
    >
      <app-icon name="bell" [size]="20" />
      @if (unread()) {
        <span class="count" aria-hidden="true">{{ unread() > 9 ? '9+' : unread() }}</span>
      }
    </button>
    @if (open()) {
      <section class="panel" aria-label="Notifications">
        <div class="head">
          <strong>Notifications</strong>
          @if (unread()) {
            <button type="button" class="link" (click)="readAll()">Mark all read</button>
          }
        </div>
        @for (n of items(); track n.id) {
          <button type="button" class="item" [class.unread]="!n.readAt" (click)="go(n)">
            <strong>{{ n.title }}</strong>
            <span class="body">{{ n.body }}</span>
            <span class="when">{{ when(n.createdAt) }}</span>
          </button>
        } @empty {
          <p class="none">Nothing yet.</p>
        }
      </section>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: inline-flex;
    }
    .toggle {
      position: relative;
      width: 40px;
      height: 40px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--surface);
      color: var(--ink-2);
      cursor: pointer;
    }
    .toggle:hover {
      background: var(--primary-tint);
      color: var(--primary);
    }
    .count {
      position: absolute;
      top: -6px;
      right: -6px;
      min-width: 20px;
      height: 20px;
      padding: 0 5px;
      border-radius: 10px;
      background: #b3261e;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .panel {
      position: absolute;
      z-index: 30;
      top: calc(100% + 8px);
      left: 0;
      width: min(360px, calc(100vw - 32px));
      max-height: min(70vh, 520px);
      overflow-y: auto;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      box-shadow: 0 16px 40px rgba(23, 33, 29, 0.18);
      display: flex;
      flex-direction: column;
    }
    @media (max-width: 640px) {
      .panel {
        left: auto;
        right: 0;
      }
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
    }
    .link {
      border: 0;
      background: none;
      padding: 0;
      font: inherit;
      font-size: 13px;
      color: var(--primary);
      cursor: pointer;
      text-decoration: underline;
    }
    .item {
      display: flex;
      flex-direction: column;
      gap: 3px;
      text-align: left;
      padding: 12px 14px;
      border: 0;
      border-bottom: 1px solid var(--border);
      background: none;
      font: inherit;
      color: var(--ink);
      cursor: pointer;
    }
    .item:last-child {
      border-bottom: 0;
    }
    .item:hover {
      background: var(--primary-tint);
    }
    .item.unread {
      box-shadow: inset 3px 0 0 var(--primary);
    }
    .item:not(.unread) strong {
      font-weight: 500;
    }
    .body {
      font-size: 13px;
      color: var(--ink-2);
    }
    .when {
      font-size: 12px;
      color: var(--muted);
    }
    .none {
      margin: 0;
      padding: 18px 14px;
      color: var(--muted);
    }
  `,
})
export class Bell {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly tz = inject(AuthService).user()?.timezone ?? 'Africa/Cairo';

  protected readonly open = signal(false);
  private readonly list = httpResource<{ unread: number; items: AppNotification[] }>(
    () => '/api/notifications',
  );
  protected readonly items = computed(() => this.list.value()?.items ?? []);
  protected readonly unread = computed(() => this.list.value()?.unread ?? 0);

  constructor() {
    const timer = setInterval(() => this.list.reload(), REFRESH_MS);
    const sub = this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) this.list.reload();
    });
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      sub.unsubscribe();
    });
  }

  protected when(iso: string) {
    return dayTime(iso, this.tz);
  }

  protected toggle() {
    this.open.update((v) => !v);
    if (this.open()) this.list.reload();
  }

  protected outside(event: Event) {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node))
      this.open.set(false);
  }

  protected async go(n: AppNotification) {
    this.open.set(false);
    if (!n.readAt) {
      await this.api.readNotifications([n.id]).catch(() => undefined);
      this.list.reload();
    }
    if (n.link) void this.router.navigateByUrl(n.link);
  }

  protected async readAll() {
    await this.api.readNotifications().catch(() => undefined);
    this.list.reload();
  }
}
