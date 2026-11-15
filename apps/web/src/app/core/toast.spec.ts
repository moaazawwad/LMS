import { HttpErrorResponse } from '@angular/common/http';
import { errorMessage } from './api.service';
import { doneText } from './toast.interceptor';
import { ToastService } from './toast.service';

describe('messages after an action', () => {
  it('says what was done, in plain words', () => {
    expect(doneText({ method: 'POST', url: '/api/lessons/abc/reschedule', body: {} })).toBe(
      'Lesson moved.',
    );
    expect(doneText({ method: 'POST', url: '/api/users/u1/active', body: { active: false } })).toBe(
      'Sign-in turned off.',
    );
    expect(doneText({ method: 'POST', url: '/api/subscriptions', body: {} })).toBe(
      'Weekly lessons added.',
    );
    // checks and sign-in say nothing
    expect(
      doneText({ method: 'POST', url: '/api/import/students', body: { commit: false } }),
    ).toBeNull();
    expect(doneText({ method: 'POST', url: '/api/auth/login', body: {} })).toBeNull();
    expect(doneText({ method: 'POST', url: '/api/lessons/x/enter', body: {} })).toBeNull();
    // anything else
    expect(doneText({ method: 'PUT', url: '/api/something/new', body: {} })).toBe('Saved.');
  });

  it('turns API errors into sentences', () => {
    const err = (status: number, error: unknown) => new HttpErrorResponse({ status, error });
    expect(
      errorMessage(
        err(400, { message: ['fullName must be longer than or equal to 2 characters'] }),
      ),
    ).toBe('Full name must be longer than or equal to 2 characters.');
    expect(errorMessage(err(500, { message: 'Internal server error' }))).toBe(
      'Something went wrong on the server. Please try again.',
    );
    expect(errorMessage(err(403, { message: 'Forbidden resource' }))).toBe(
      "You don't have permission to do that.",
    );
    expect(errorMessage(err(409, { message: 'Only scheduled lessons can be transferred.' }))).toBe(
      'Only scheduled lessons can be transferred.',
    );
  });

  it('shows one box per action: the page’s own words replace the generic ones', () => {
    const t = new ToastService();
    t.success('Lesson added.');
    t.success('Lesson added to invoice INV-0002.');
    expect(t.toasts().map((x) => x.text)).toEqual(['Lesson added to invoice INV-0002.']);
    t.error('The teacher is not free then.');
    t.error('The teacher is not free then.');
    expect(t.toasts().filter((x) => x.kind === 'error')).toHaveLength(1);
  });
});
