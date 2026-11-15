import { inject } from '@angular/core';
import { type CanMatchFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import type { Role, StaffArea } from './models';

/** Lets the route through only for these roles; everyone else goes to their own home. */
export function roleGuard(...roles: Role[]): CanMatchFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (!auth.user()) return router.parseUrl('/login');
    return auth.hasRole(...roles) ? true : router.parseUrl(auth.homePath());
  };
}

/** Staff pages a staff account may not use send it back to Today. */
export function areaGuard(area: StaffArea): CanMatchFn {
  return () => {
    const auth = inject(AuthService);
    return auth.can(area) ? true : inject(Router).parseUrl('/admin/today');
  };
}

/** Sends "/" to the signed-in person's home. */
export const homeRedirect: CanMatchFn = () => {
  const auth = inject(AuthService);
  return inject(Router).parseUrl(auth.homePath());
};
