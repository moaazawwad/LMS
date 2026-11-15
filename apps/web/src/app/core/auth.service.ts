import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { AuthUser, Role, StaffArea } from './models';

const STORAGE_KEY = 'lms.session';

interface Session {
  accessToken: string;
  user: AuthUser;
}

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly session = signal<Session | null>(readSession());

  readonly user = computed(() => this.session()?.user ?? null);
  readonly token = computed(() => this.session()?.accessToken ?? null);

  async login(email: string, password: string): Promise<void> {
    const session = await firstValueFrom(
      this.http.post<Session>('/api/auth/login', { email, password }),
    );
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      // private mode: the session lasts until the tab closes
    }
    this.session.set(session);
    await this.router.navigateByUrl(this.homePath());
  }

  logout(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // nothing to clear
    }
    this.session.set(null);
    void this.router.navigateByUrl('/login');
  }

  /** Staff accounts can be limited to some areas; everyone else is not. */
  can(area: StaffArea): boolean {
    const u = this.user();
    if (!u) return false;
    if (u.role !== 'STAFF') return u.role === 'ADMIN';
    return !u.areas || u.areas.includes(area);
  }

  /** Pick up changes an admin made (areas, name) without signing in again. */
  async refresh(): Promise<void> {
    const current = this.session();
    if (!current) return;
    try {
      const me = await firstValueFrom(this.http.get<AuthUser>('/api/auth/me'));
      const user: AuthUser = { ...current.user, fullName: me.fullName, areas: me.areas ?? null };
      const next = { ...current, user };
      this.session.set(next);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // offline or signed out: keep what we have
    }
  }

  hasRole(...roles: Role[]): boolean {
    const role = this.user()?.role;
    return !!role && roles.includes(role);
  }

  homePath(): string {
    switch (this.user()?.role) {
      case 'ADMIN':
      case 'STAFF':
        return '/admin';
      case 'TEACHER':
        return '/teacher';
      case 'STUDENT':
        return '/student';
      default:
        return '/login';
    }
  }
}
