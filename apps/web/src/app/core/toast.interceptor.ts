import {
  HttpContextToken,
  HttpErrorResponse,
  type HttpInterceptorFn,
  type HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, tap, throwError } from 'rxjs';
import { errorMessage } from './api.service';
import { ToastService } from './toast.service';

/** Set on a request that should not show a message (background saves, checks). */
export const QUIET = new HttpContextToken<boolean>(() => false);

type Rule = [method: string, path: RegExp, text: string | ((body: unknown) => string | null)];

const ID = '[^/]+';
const re = (p: string) => new RegExp(`^${p.replaceAll(':id', ID)}$`);

/**
 * What each action says when it worked. A path that is not listed says "Saved.";
 * null means say nothing (sign-in, Enter class, checks before saving).
 */
const DONE: Rule[] = [
  // signing in and out, and the public pages, speak for themselves
  ['POST', re('/auth/(login|refresh|logout|forgot-password|reset-password)'), () => null],
  ['POST', re('/public/.*'), () => null],
  ['POST', re('/lessons/:id/enter'), () => null],
  ['POST', re('/exports.*'), () => null],
  ['POST', re('/notifications/read'), () => null],

  ['PATCH', re('/auth/me'), 'Your details were saved.'],
  ['POST', re('/auth/password'), 'Your password was changed.'],

  ['POST', re('/students'), 'Student added.'],
  ['PATCH', re('/students/:id'), 'Student details saved.'],
  ['POST', re('/teachers'), 'Teacher added.'],
  ['PATCH', re('/teachers/:id'), 'Teacher details saved.'],
  ['PUT', re('/teachers/:id/availability'), 'Weekly hours saved.'],
  ['PUT', re('/teachers/:id/bank'), 'Payment details saved.'],
  ['POST', re('/teachers/:id/notes'), 'Note added.'],
  ['DELETE', re('/teachers/:id/notes/:id'), 'Note removed.'],
  ['POST', re('/staff'), 'Staff member added.'],
  ['PATCH', re('/staff/:id'), 'Staff member saved.'],
  [
    'POST',
    re('/users/:id/active'),
    (b) => ((b as { active?: boolean })?.active ? 'Sign-in turned on.' : 'Sign-in turned off.'),
  ],
  ['POST', re('/users/:id/password'), 'Password reset.'],
  [
    'POST',
    re('/import/.*'),
    (b) => ((b as { commit?: boolean })?.commit ? 'Accounts created.' : null),
  ],

  ['POST', re('/subscriptions'), 'Weekly lessons added.'],
  ['PATCH', re('/subscriptions/:id'), 'Weekly times saved.'],
  ['POST', re('/subscriptions/:id/transfer'), 'Lessons transferred.'],
  ['POST', re('/subscriptions/:id/pause'), 'Subscription paused.'],

  ['POST', re('/lessons/extra'), 'Lesson added.'],
  ['POST', re('/lessons/trial'), 'Trial lesson booked.'],
  ['POST', re('/lessons/:id/reschedule'), 'Lesson moved.'],
  ['POST', re('/lessons/:id/cancel'), 'Lesson cancelled.'],
  ['POST', re('/lessons/:id/transfer'), 'Lesson transferred.'],
  ['POST', re('/lessons/:id/attendance'), 'Attendance saved.'],
  ['PATCH', re('/lessons/:id/notes'), 'Notes and homework saved.'],
  ['POST', re('/lessons/:id/homework'), 'Homework sent.'],
  ['POST', re('/lessons/:id/homework/feedback'), 'Reply sent.'],
  ['POST', re('/lessons/:id/homework/files'), 'File added.'],
  ['DELETE', re('/lessons/:id/homework/files/:id'), 'File removed.'],

  ['POST', re('/requests'), 'Request sent.'],
  ['POST', re('/requests/:id/approve'), 'Request approved.'],
  ['POST', re('/requests/:id/decline'), 'Request declined.'],
  ['POST', re('/requests/:id/withdraw'), 'Request withdrawn.'],

  ['POST', re('/invoices'), 'Invoice issued.'],
  ['POST', re('/invoices/:id/pay'), 'Invoice marked as paid.'],
  ['POST', re('/invoices/:id/unpay'), 'Payment taken back: the invoice is due again.'],
  ['POST', re('/students/:id/notes'), 'Note added.'],
  ['DELETE', re('/students/:id/notes/:id'), 'Note removed.'],
  ['POST', re('/invoices/:id/void'), 'Invoice voided.'],
  ['POST', re('/payouts'), 'Payment recorded.'],
  ['POST', re('/payouts/:id/undo'), 'Payment undone.'],
  ['PUT', re('/level-pay-rates'), 'Pay rates saved.'],
  ['PUT', re('/academy-settings'), 'Payment details saved.'],

  ['POST', re('/curricula'), 'Curriculum added.'],
  ['PATCH', re('/curricula/:id'), 'Curriculum saved.'],
  ['POST', re('/curricula/:id/files'), 'Book uploaded.'],
  ['DELETE', re('/curricula/:id/files/:id'), 'Book removed.'],
  ['POST', re('/plans'), 'Plan added.'],
  ['PATCH', re('/plans/:id'), 'Plan saved.'],
  ['PATCH', re('/applications/:id'), 'Application updated.'],
  ['POST', re('/mail/test'), 'Test email sent.'],
];

const CHANGES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function doneText(req: Pick<HttpRequest<unknown>, 'method' | 'url' | 'body'>) {
  const path = req.url.replace(/^\/api/, '').split('?')[0];
  const rule = DONE.find(([m, p]) => m === req.method && p.test(path));
  if (!rule) return 'Saved.';
  const text = rule[2];
  return typeof text === 'function' ? text(req.body) : text;
}

/** Sign-in pages show their own errors next to the form. */
function quietError(req: HttpRequest<unknown>) {
  return /\/auth\/(login|refresh|forgot-password|reset-password)$/.test(req.url.split('?')[0]);
}

/**
 * After every change sent to the API: a green "Done" message when it worked,
 * a red "Not done" with the reason when it failed. Reading never shows anything.
 */
export const toastInterceptor: HttpInterceptorFn = (req, next) => {
  if (!CHANGES.has(req.method) || !req.url.startsWith('/api/') || req.context.get(QUIET))
    return next(req);
  const toast = inject(ToastService);
  return next(req).pipe(
    tap((event) => {
      if (!(event instanceof HttpResponse)) return;
      const text = doneText(req);
      if (text) toast.success(text);
    }),
    catchError((err: unknown) => {
      // 401 signs out; the sign-in page says why.
      if (!(err instanceof HttpErrorResponse && err.status === 401) && !quietError(req))
        toast.error(errorMessage(err));
      return throwError(() => err);
    }),
  );
};
