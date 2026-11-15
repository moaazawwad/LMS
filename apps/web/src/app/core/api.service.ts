import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  CancelReason,
  ChangeRequest,
  Curriculum,
  CurriculumFile,
  HomeworkFile,
  Invoice,
  PayResult,
  PaymentMethod,
  LevelPayRate,
  Lesson,
  TeacherBank,
  TeacherNote,
  TeacherProfileFields,
  Payout,
  Plan,
  RequestKind,
  ReviewOutcome,
  RuleViolationError,
  Slot,
  StaffArea,
  StaffMember,
  Tier,
} from './models';

/** Changes that go to the API. Reads use httpResource() inside the pages. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  enterClass(lessonId: string) {
    return firstValueFrom(
      this.http.post<{ zoomLink: string | null; status: string }>(
        `/api/lessons/${lessonId}/enter`,
        {},
      ),
    );
  }

  cancelLesson(
    lessonId: string,
    body: {
      reason?: CancelReason;
      teacherRemedy?: 'MAKEUP' | 'CREDIT';
      override?: boolean;
      note?: string;
    } = {},
  ) {
    return firstValueFrom(
      this.http.post<{ lesson: Lesson }>(`/api/lessons/${lessonId}/cancel`, body),
    );
  }

  rescheduleLesson(
    lessonId: string,
    body: {
      startsAt: string;
      requestedBy?: 'STUDENT' | 'TEACHER' | 'ADMIN';
      override?: boolean;
      note?: string;
    },
  ) {
    return firstValueFrom(this.http.post<Lesson>(`/api/lessons/${lessonId}/reschedule`, body));
  }

  /** Staff: what happened in a lesson someone did not enter. */
  reviewAttendance(
    lessonId: string,
    body: { outcome: ReviewOutcome; teacherRemedy?: 'MAKEUP' | 'CREDIT'; note?: string },
  ) {
    return firstValueFrom(this.http.post<Lesson>(`/api/lessons/${lessonId}/attendance`, body));
  }

  createRequest(body: {
    lessonId: string;
    kind: RequestKind;
    message: string;
    preferredTimes?: string;
  }) {
    return firstValueFrom(this.http.post<ChangeRequest>('/api/requests', body));
  }

  approveRequest(
    id: string,
    body: {
      note?: string;
      startsAt?: string;
      credit?: boolean;
      teacherRemedy?: 'MAKEUP' | 'CREDIT';
      override?: boolean;
    },
  ) {
    return firstValueFrom(this.http.post<ChangeRequest>(`/api/requests/${id}/approve`, body));
  }

  declineRequest(id: string, note: string) {
    return firstValueFrom(this.http.post<ChangeRequest>(`/api/requests/${id}/decline`, { note }));
  }

  withdrawRequest(id: string) {
    return firstValueFrom(this.http.post<ChangeRequest>(`/api/requests/${id}/withdraw`, {}));
  }

  /** Downloads a CSV export (the token goes in a header, so not a plain link). */
  /** The monthly report as a CSV file. */
  async downloadMonthCsv(month: string) {
    const blob = await firstValueFrom(
      this.http.get('/api/exports/month.csv', { params: { month }, responseType: 'blob' }),
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${month}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async downloadCsv(kind: 'invoices' | 'lessons', from: string, to: string) {
    let blob: Blob;
    try {
      blob = await firstValueFrom(
        this.http.get(`/api/exports/${kind}.csv`, { params: { from, to }, responseType: 'blob' }),
      );
    } catch (err) {
      // With responseType blob, an error body arrives as a Blob too: read its message.
      if (err instanceof HttpErrorResponse && err.error instanceof Blob) {
        const text = await err.error.text();
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          /* not JSON */
        }
        throw new HttpErrorResponse({
          error: body,
          status: err.status,
          statusText: err.statusText,
          url: err.url ?? undefined,
        });
      }
      throw err;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${kind}_${from}_${to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Lessons that started before `to`, newest first. Page back by passing the oldest `startsAt` as `to`. */
  lessonHistory(to: string, limit: number) {
    return firstValueFrom(
      this.http.get<Lesson[]>('/api/lessons', { params: { to, order: 'desc', limit } }),
    );
  }

  /** Student: attach a photo, PDF or recording to the homework answer. */
  uploadHomeworkFile(lessonId: string, file: File) {
    const form = new FormData();
    form.append('file', file, file.name);
    return firstValueFrom(
      this.http.post<HomeworkFile[]>(`/api/lessons/${lessonId}/homework/files`, form),
    );
  }

  removeHomeworkFile(lessonId: string, fileId: string) {
    return firstValueFrom(
      this.http.delete<HomeworkFile[]>(`/api/lessons/${lessonId}/homework/files/${fileId}`),
    );
  }

  /** Saves the file on this device (the link needs the sign-in, so it goes through here). */
  /** Fetch a file with the sign-in token, then open it in a new tab or save it. */
  async openFile(url: string, fileName: string, save = false) {
    // Open the tab first (while the click still counts), then fill it in.
    const tab = save ? null : window.open('', '_blank');
    const blob = await firstValueFrom(this.http.get(url, { responseType: 'blob' }));
    const href = URL.createObjectURL(blob);
    if (tab) {
      tab.location.href = href;
    } else {
      const a = document.createElement('a');
      a.href = href;
      a.download = fileName;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  }

  /** Staff: add a PDF book to a curriculum. */
  uploadBook(curriculumId: string, file: File, title: string) {
    const form = new FormData();
    form.append('file', file);
    if (title.trim()) form.append('title', title.trim());
    return firstValueFrom(
      this.http.post<CurriculumFile>(`/api/curricula/${curriculumId}/files`, form),
    );
  }

  removeBook(curriculumId: string, fileId: string) {
    return firstValueFrom(this.http.delete(`/api/curricula/${curriculumId}/files/${fileId}`));
  }

  async downloadHomeworkFile(lessonId: string, f: HomeworkFile) {
    const blob = await firstValueFrom(
      this.http.get(`/api/lessons/${lessonId}/homework/files/${f.id}`, { responseType: 'blob' }),
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Student: send or change the homework answer. */
  sendHomework(lessonId: string, answer: string) {
    return firstValueFrom(this.http.post<Lesson>(`/api/lessons/${lessonId}/homework`, { answer }));
  }

  /** Teacher (or academy): reply to the answer. */
  homeworkFeedback(lessonId: string, feedback: string) {
    return firstValueFrom(
      this.http.post<Lesson>(`/api/lessons/${lessonId}/homework/feedback`, { feedback }),
    );
  }

  saveNotes(
    lessonId: string,
    body: { notes?: string; homeworkTitle?: string; homeworkBody?: string },
  ) {
    return firstValueFrom(this.http.patch(`/api/lessons/${lessonId}/notes`, body));
  }

  /** Record a payment: how it came in, its reference, the day it arrived. */
  payInvoice(
    id: string,
    body: { method?: PaymentMethod; reference?: string; receivedOn?: string; note?: string } = {},
  ) {
    return firstValueFrom(this.http.post<PayResult>(`/api/invoices/${id}/pay`, body));
  }

  /** Admin only: take back a payment recorded by mistake. */
  unpayInvoice(id: string, reason: string) {
    return firstValueFrom(this.http.post<Invoice>(`/api/invoices/${id}/unpay`, { reason }));
  }

  /** Mark the given notices read, or all of them. */
  readNotifications(ids?: string[]) {
    return firstValueFrom(
      this.http.post<{ read: number }>('/api/notifications/read', ids ? { ids } : {}),
    );
  }

  /** Admin only: record a teacher's month as paid. */
  recordPayout(body: { teacherId: string; month: string; note?: string; override?: boolean }) {
    return firstValueFrom(this.http.post<Payout>('/api/payouts', body));
  }

  setLevelRates(rates: { level: Tier; hourlyRateCents: number | null; currency: string }[]) {
    return firstValueFrom(this.http.put<LevelPayRate[]>('/api/level-pay-rates', { rates }));
  }

  undoPayout(id: string, note: string) {
    return firstValueFrom(this.http.post<{ id: string }>(`/api/payouts/${id}/undo`, { note }));
  }

  /** Admin only. With reissue, a new invoice for the same cycle comes back. */
  voidInvoice(id: string, reason: string, reissue: boolean, billLessons?: number) {
    return firstValueFrom(
      this.http.post<{
        id: string;
        replacement: { id: string; number: string; totalCents: number } | null;
      }>(`/api/invoices/${id}/void`, {
        reason,
        reissue,
        ...(billLessons === undefined ? {} : { billLessons }),
      }),
    );
  }

  // ----- people -----

  createStudent(body: {
    email: string;
    fullName: string;
    password: string;
    phone?: string;
    timezone: string;
    address?: string;
    country?: string;
  }) {
    return firstValueFrom(this.http.post<{ id: string; userId: string }>('/api/students', body));
  }

  /** A free one-off trial lesson. */
  bookTrial(body: {
    studentId: string;
    teacherId: string;
    curriculumId: string;
    startsAt: string;
    durationMin: number;
    override?: boolean;
    note?: string;
  }) {
    return firstValueFrom(this.http.post<{ id: string }>('/api/lessons/trial', body));
  }

  updateStudent(
    id: string,
    body: {
      fullName?: string;
      phone?: string;
      timezone?: string;
      status?: string;
      address?: string;
      country?: string;
    },
  ) {
    return firstValueFrom(this.http.patch<{ id: string }>(`/api/students/${id}`, body));
  }

  createTeacher(
    body: {
      email: string;
      fullName: string;
      password: string;
      phone?: string;
      level: Tier;
      zoomLink?: string;
      bio?: string;
      curriculumIds: string[];
      /** admins only */
      hourlyRateCents?: number | null;
      rateCurrency?: string;
    } & TeacherProfileFields,
  ) {
    return firstValueFrom(this.http.post<{ id: string; userId: string }>('/api/teachers', body));
  }

  updateTeacher(
    id: string,
    body: {
      fullName?: string;
      phone?: string;
      level?: Tier;
      status?: string;
      zoomLink?: string;
      bio?: string;
      curriculumIds?: string[];
      /** admins only */
      hourlyRateCents?: number | null;
      rateCurrency?: string;
    } & TeacherProfileFields,
  ) {
    return firstValueFrom(this.http.patch<{ id: string }>(`/api/teachers/${id}`, body));
  }

  /** Admins only: how the teacher is paid. Empty text clears a field. */
  setTeacherBank(id: string, body: Partial<Record<keyof TeacherBank, string | null>>) {
    return firstValueFrom(this.http.put<TeacherBank>(`/api/teachers/${id}/bank`, body));
  }

  addTeacherNote(id: string, body: string) {
    return firstValueFrom(this.http.post<TeacherNote>(`/api/teachers/${id}/notes`, { body }));
  }

  removeTeacherNote(id: string, noteId: string) {
    return firstValueFrom(this.http.delete<void>(`/api/teachers/${id}/notes/${noteId}`));
  }

  setAvailability(
    teacherId: string,
    windows: { weekday: number; startMinute: number; endMinute: number }[],
  ) {
    return firstValueFrom(
      this.http.put<{ lessonsOutside: number }>(`/api/teachers/${teacherId}/availability`, {
        windows,
      }),
    );
  }

  resetPassword(userId: string, newPassword: string) {
    return firstValueFrom(this.http.post<void>(`/api/users/${userId}/password`, { newPassword }));
  }

  setSignIn(userId: string, isActive: boolean) {
    return firstValueFrom(this.http.post(`/api/users/${userId}/active`, { isActive }));
  }

  // ----- subscriptions -----

  createSubscription(body: {
    studentId: string;
    teacherId: string;
    curriculumId: string;
    planId?: string;
    lessonsPerWeek?: number;
    startDate: string;
    slots: Slot[];
    override?: boolean;
    note?: string;
  }) {
    return firstValueFrom(
      this.http.post<{ id: string; lessonsCreated: number }>('/api/subscriptions', body),
    );
  }

  updateSubscription(
    id: string,
    body: {
      planId?: string;
      lessonsPerWeek?: number;
      slots?: Slot[];
      /** move the upcoming lessons now instead of from the next cycle */
      applyNow?: boolean;
      override?: boolean;
      note?: string;
    },
  ) {
    return firstValueFrom(
      this.http.patch<{
        id: string;
        moved: { moved: number; added: number; dropped: number; invoices: string[] } | null;
      }>(`/api/subscriptions/${id}`, body),
    );
  }

  /** One lesson to another teacher (the rest stay with theirs). */
  transferLesson(id: string, body: { teacherId: string; override?: boolean }) {
    return firstValueFrom(this.http.post<Lesson>(`/api/lessons/${id}/transfer`, body));
  }

  transferSubscription(id: string, body: { teacherId: string; override?: boolean }) {
    return firstValueFrom(
      this.http.post<{ lessonsMoved: number }>(`/api/subscriptions/${id}/transfer`, body),
    );
  }

  pauseSubscription(id: string, note?: string) {
    return firstValueFrom(
      this.http.post<{ lessonsCancelled: number }>(`/api/subscriptions/${id}/pause`, { note }),
    );
  }

  addExtraLesson(body: {
    subscriptionId: string;
    startsAt: string;
    extraReason: 'MAKEUP' | 'OTHER';
    forLessonId?: string;
    /** another teacher or curriculum for this one lesson */
    teacherId?: string;
    curriculumId?: string;
    override?: boolean;
  }) {
    return firstValueFrom(
      this.http.post<{
        id: string;
        billing: { invoiceNumber: string | null; pending: boolean } | null;
      }>('/api/lessons/extra', body),
    );
  }

  // ----- catalogue & staff -----

  saveCurriculum(body: Partial<Curriculum> & { name?: string }, id?: string) {
    return firstValueFrom(
      id
        ? this.http.patch<Curriculum>(`/api/curricula/${id}`, body)
        : this.http.post<Curriculum>('/api/curricula', body),
    );
  }

  savePlan(body: Partial<Plan>, id?: string) {
    return firstValueFrom(
      id
        ? this.http.patch<Plan>(`/api/plans/${id}`, body)
        : this.http.post<Plan>('/api/plans', body),
    );
  }

  createStaff(body: {
    email: string;
    fullName: string;
    password: string;
    role: 'ADMIN' | 'STAFF';
    areas?: StaffArea[];
  }) {
    return firstValueFrom(this.http.post<StaffMember>('/api/staff', body));
  }

  updateStaff(
    id: string,
    body: { fullName?: string; role?: 'ADMIN' | 'STAFF'; isActive?: boolean; areas?: StaffArea[] },
  ) {
    return firstValueFrom(this.http.patch<StaffMember>(`/api/staff/${id}`, body));
  }
}

/**
 * Rule violations as short sentences. When one action touches many lessons
 * (a new subscription, a transfer) the same reason repeats per lesson, so it
 * is said once with the lesson times after it.
 */
export function violationText(violations: RuleViolationError['violations'], maxTimes = 3): string {
  const groups = new Map<string, string[]>();
  for (const v of violations) {
    const reason =
      v.at && v.message.startsWith(`${v.at}: `) ? v.message.slice(v.at.length + 2) : v.message;
    const times = groups.get(reason) ?? [];
    if (v.at) times.push(v.at);
    groups.set(reason, times);
  }
  return [...groups]
    .map(([reason, times]) => {
      if (!times.length) return reason;
      const label = times.length === 1 ? '1 lesson' : `${times.length} lessons`;
      const shown = times.slice(0, maxTimes).join('; ');
      const more = times.length > maxTimes ? `; and ${times.length - maxTimes} more` : '';
      return `${reason.replace(/\.$/, '')} (${label}: ${shown}${more}).`;
    })
    .join(' ');
}

/** A readable message from any API error, including rule violations. */
/** "fullName must be an email" → "Full name must be an email." */
function plain(message: string): string {
  const words = message
    .trim()
    .replace(/^([a-z]+[A-Z][A-Za-z]*)/, (f) => f.replace(/([A-Z])/g, ' $1').toLowerCase());
  const text = words.charAt(0).toUpperCase() + words.slice(1);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

export function errorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as Partial<RuleViolationError> & { message?: string | string[] };
    if (body?.violations?.length) return violationText(body.violations);
    if (err.status === 0) return 'Cannot reach the server. Check the connection and try again.';
    if (err.status >= 500) return 'Something went wrong on the server. Please try again.';
    if (err.status === 403 && (!body?.message || body.message === 'Forbidden resource'))
      return "You don't have permission to do that.";
    if (Array.isArray(body?.message)) return [...new Set(body.message.map(plain))].join(' ');
    if (typeof body?.message === 'string') return plain(body.message);
  }
  return 'Something went wrong. Please try again.';
}
