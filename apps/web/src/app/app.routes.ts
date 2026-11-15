import type { Routes } from '@angular/router';
import { areaGuard, homeRedirect, roleGuard } from './core/guards';
import { Shell } from './layout/shell';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login').then((m) => m.Login) },
  {
    path: 'forgot-password',
    loadComponent: () => import('./pages/password-reset').then((m) => m.ForgotPassword),
  },
  {
    path: 'reset-password',
    loadComponent: () => import('./pages/password-reset').then((m) => m.ResetPassword),
  },
  {
    path: 'admin',
    component: Shell,
    canMatch: [roleGuard('ADMIN', 'STAFF')],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'today' },
      {
        path: 'today',
        loadComponent: () => import('./pages/admin/today').then((m) => m.AdminToday),
      },
      {
        path: 'schedule-check',
        loadComponent: () => import('./pages/admin/schedule-page').then((m) => m.AdminSchedulePage),
      },
      {
        path: 'students',
        loadComponent: () => import('./pages/admin/students').then((m) => m.AdminStudents),
      },
      {
        path: 'students/new',
        canMatch: [areaGuard('students')],
        loadComponent: () => import('./pages/admin/student-form').then((m) => m.AdminStudentForm),
      },
      {
        path: 'students/import',
        canMatch: [roleGuard('ADMIN')],
        data: { kind: 'students' },
        loadComponent: () => import('./pages/admin/import').then((m) => m.AdminImport),
      },
      {
        path: 'students/:id',
        loadComponent: () =>
          import('./pages/admin/student-detail').then((m) => m.AdminStudentDetail),
      },
      {
        path: 'students/:id/calendar',
        data: { kind: 'student' },
        loadComponent: () =>
          import('./pages/admin/person-calendar').then((m) => m.AdminPersonCalendar),
      },
      {
        path: 'students/:id/edit',
        canMatch: [areaGuard('students')],
        loadComponent: () => import('./pages/admin/student-form').then((m) => m.AdminStudentForm),
      },
      {
        path: 'students/:id/add-lesson',
        canMatch: [areaGuard('students')],
        loadComponent: () => import('./pages/admin/add-lesson').then((m) => m.AdminAddLesson),
      },
      {
        path: 'students/:id/transfer',
        canMatch: [areaGuard('lessons')],
        loadComponent: () => import('./pages/admin/transfer').then((m) => m.AdminTransfer),
      },
      // Older links: the same steps, opened on that kind of lesson.
      {
        path: 'students/:id/subscribe',
        redirectTo: ({ params, queryParams }) =>
          `/admin/students/${params['id']}/add-lesson?kind=weekly${queryParams['created'] ? '&created=1' : ''}`,
      },
      {
        path: 'students/:id/trial',
        redirectTo: ({ params }) => `/admin/students/${params['id']}/add-lesson?kind=trial`,
      },
      {
        path: 'subscriptions/:id',
        loadComponent: () => import('./pages/admin/subscription').then((m) => m.AdminSubscription),
      },
      {
        path: 'teachers',
        loadComponent: () => import('./pages/admin/teachers').then((m) => m.AdminTeachers),
      },
      {
        path: 'teachers/new',
        canMatch: [areaGuard('teachers')],
        loadComponent: () => import('./pages/admin/teacher-form').then((m) => m.AdminTeacherForm),
      },
      {
        path: 'teachers/import',
        canMatch: [roleGuard('ADMIN')],
        data: { kind: 'teachers' },
        loadComponent: () => import('./pages/admin/import').then((m) => m.AdminImport),
      },
      {
        path: 'teachers/:id',
        loadComponent: () =>
          import('./pages/admin/teacher-detail').then((m) => m.AdminTeacherDetail),
      },
      {
        path: 'teachers/:id/calendar',
        data: { kind: 'teacher' },
        loadComponent: () =>
          import('./pages/admin/person-calendar').then((m) => m.AdminPersonCalendar),
      },
      {
        path: 'teachers/:id/edit',
        canMatch: [areaGuard('teachers')],
        loadComponent: () => import('./pages/admin/teacher-form').then((m) => m.AdminTeacherForm),
      },
      {
        path: 'teachers/:id/availability',
        canMatch: [areaGuard('teachers')],
        loadComponent: () => import('./pages/admin/availability').then((m) => m.AdminAvailability),
      },
      {
        path: 'lessons',
        canMatch: [areaGuard('lessons')],
        loadComponent: () => import('./pages/admin/lessons').then((m) => m.AdminLessons),
      },
      {
        path: 'lessons/:id',
        canMatch: [areaGuard('lessons')],
        loadComponent: () => import('./pages/admin/lesson').then((m) => m.AdminLesson),
      },
      {
        path: 'requests',
        canMatch: [areaGuard('lessons')],
        loadComponent: () => import('./pages/admin/requests').then((m) => m.AdminRequests),
      },
      {
        path: 'invoices',
        canMatch: [areaGuard('billing')],
        loadComponent: () => import('./pages/admin/invoices').then((m) => m.AdminInvoices),
      },
      {
        path: 'invoices/:id',
        canMatch: [areaGuard('billing')],
        loadComponent: () => import('./pages/invoice').then((m) => m.InvoicePage),
      },
      {
        path: 'reports',
        canMatch: [areaGuard('billing')],
        loadComponent: () => import('./pages/admin/reports').then((m) => m.AdminReports),
      },
      {
        path: 'catalog',
        canMatch: [areaGuard('catalog')],
        loadComponent: () => import('./pages/admin/catalog').then((m) => m.AdminCatalog),
      },
      {
        path: 'staff',
        canMatch: [roleGuard('ADMIN')],
        loadComponent: () => import('./pages/admin/staff').then((m) => m.AdminStaff),
      },
      // The activity now sits on each page (a student's, an invoice's…).
      { path: 'logs', redirectTo: 'today' },
      { path: 'settings', loadComponent: () => import('./pages/settings').then((m) => m.Settings) },
    ],
  },
  {
    path: 'teacher',
    component: Shell,
    canMatch: [roleGuard('TEACHER')],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'today' },
      {
        path: 'today',
        loadComponent: () => import('./pages/teacher/today').then((m) => m.TeacherToday),
      },
      {
        path: 'calendar',
        loadComponent: () => import('./pages/teacher/calendar').then((m) => m.TeacherCalendar),
      },
      {
        path: 'history',
        loadComponent: () => import('./pages/teacher/history').then((m) => m.TeacherHistory),
      },
      {
        path: 'lessons/:id',
        loadComponent: () => import('./pages/teacher/lesson').then((m) => m.TeacherLesson),
      },
      { path: 'ask/:lessonId', loadComponent: () => import('./pages/ask').then((m) => m.Ask) },
      { path: 'books', loadComponent: () => import('./pages/books').then((m) => m.Books) },
      { path: 'settings', loadComponent: () => import('./pages/settings').then((m) => m.Settings) },
    ],
  },
  {
    path: 'student',
    component: Shell,
    canMatch: [roleGuard('STUDENT')],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      {
        path: 'home',
        loadComponent: () => import('./pages/student/home').then((m) => m.StudentHome),
      },
      {
        path: 'lessons',
        loadComponent: () => import('./pages/student/lessons').then((m) => m.StudentLessons),
      },
      {
        path: 'lessons/:id',
        loadComponent: () => import('./pages/student/lesson').then((m) => m.StudentLesson),
      },
      {
        path: 'reschedule/:id',
        loadComponent: () => import('./pages/student/reschedule').then((m) => m.StudentReschedule),
      },
      { path: 'ask/:lessonId', loadComponent: () => import('./pages/ask').then((m) => m.Ask) },
      { path: 'books', loadComponent: () => import('./pages/books').then((m) => m.Books) },
      {
        path: 'calendar',
        loadComponent: () => import('./pages/student/calendar').then((m) => m.StudentCalendar),
      },
      {
        path: 'invoices',
        loadComponent: () => import('./pages/student/invoices').then((m) => m.StudentInvoices),
      },
      {
        path: 'invoices/:id',
        loadComponent: () => import('./pages/invoice').then((m) => m.InvoicePage),
      },
      { path: 'settings', loadComponent: () => import('./pages/settings').then((m) => m.Settings) },
    ],
  },
  { path: '**', canMatch: [homeRedirect], children: [] },
];
