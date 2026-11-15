# Brightverse Academy LMS

Admin, staff, teacher and student dashboards for Brightverse Academy (online 1-on-1 Quran and Arabic lessons; teachers in Egypt, students worldwide).
The owner is **Moaaz**. He writes in Egyptian Arabic: answer him in Egyptian Arabic, short and practical. The app itself (UI, messages, docs for developers) is in English.
The academy's public PHP website is the sibling repo/folder `../brightverse-website` (its own `CLAUDE.md`).

Read this file first, then `docs/ROADMAP.md` (what is done, what is next, decisions still open) and `README.md` (every feature and rule in detail).

## Stack

- `apps/api`: NestJS 12 (ESM) + Drizzle 0.45 + PostgreSQL 16. Tables in `src/db/schema.ts`, SQL migrations in `drizzle/` (latest: `0015_payments-holds-notifications-student-profile`).
- `apps/web`: Angular 22, standalone components, zoneless, signals (`signal`, `computed`, `linkedSignal`, `httpResource`, `input()`, `model()`), new control flow (`@if`, `@for`, `@switch`), OnPush everywhere.
- Node 24 (`.nvmrc`). Docker for PostgreSQL locally (`docker-compose.yml`). One Docker image serves API + web in production (Railway).

## Run it

```bash
docker compose up -d                 # PostgreSQL on :5432 (lms/lms), also creates lms_test and lms_ui_test
npm run setup                        # installs both apps (run from the repo root)
cd apps/api && cp .env.example .env  # once
npm run db:migrate && npm run build && npm run db:seed   # seed = demo data, WIPES lms
npm run start:dev                    # API on :3000
cd apps/web && npm start             # web on :4200, proxies /api
```

Demo sign-ins (password `ChangeMe123!`): admin@ / staff@ / ahmed@ mona@ khaled@ (teachers) / omar@ aisha@ mariam@ youssef@ (students) `@academy.local`.
On Windows PowerShell, if `npm` is blocked: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

## Tests: all must pass before a change is done

```bash
cd apps/api && npm run lint && npm test                                   # unit (78)
TEST_DATABASE_URL=postgresql://lms:lms@localhost:5432/lms_test npm run test:e2e   # API e2e (261), WIPES lms_test
cd apps/web && npm test -- --watch=false                                  # unit (27)
npm run test:ui                                                           # Playwright (75), from the root; seeds lms_ui_test
```

Every new feature gets an API e2e test and a Playwright test. Playwright tests run against the seed: a test that changes demo students (Omar, Aisha…) can break another file's expectations, so create your own student/teacher in the test when you change data. Some seed data is relative to "now" (cycles, attendance cases); watch for tests that depend on the day or the hour.
`.github/workflows/ci.yml` runs everything on each push to `main`.

## Where things are

- Business rules (pure functions, unit-tested): `apps/api/src/rules/` (`lesson-rules.ts`, `billing.ts`, `schedule.ts`, `clock.ts`).
- Overrides: `common/override.ts`. Staff may go past a rule with `override: true`; nobody writes a note, the log records "Overrode: <rules>".
- Audit log: `audit/audit.service.ts`. Every change writes an entry in the same transaction. `GET /audit-logs` filters by `studentId`, `teacherId`, `entityType`+`entityId`, `actions=lesson.,homework.` (prefixes).
- Web: pages in `apps/web/src/app/pages/{admin,teacher,student}`, shared pieces in `shared/`, API calls in `core/api.service.ts`, types in `core/models.ts`.

## Product decisions (don't undo without asking Moaaz)

- **Plans follow the hours**, per 28-day cycle: 1 lesson/week = Basic (4 h), 2 = Standard (8 h), 3+ = Premium (12 h+). Price is per lesson (Basic 11.25, Standard 10, Premium 9 USD in the seed; real prices are set in the admin). Quotas: Basic 1 cancel + 1 reschedule, Standard 2 + 2, Premium unlimited. 4-hour notice for students.
- **Teachers are paid per hour** by level (Premium/Standard/Basic rates) unless they have their own rate. Pay and bank details are **admins only**; the log never shows bank numbers.
- Teachers can cancel 4 lessons a Cairo month (no-shows count). Teachers don't cancel themselves: they ask; the academy picks a makeup or a credit.
- **Lessons are moved/cancelled from the student's side only** (student row Actions, student page, lesson page). Teacher rows have no reschedule/cancel.
- **Add a lesson** (`pages/admin/add-lesson.ts`) is one flow: one lesson / every week / free trial → same or another teacher → details. **Transfer** (`pages/admin/transfer.ts`) only moves lessons: for good or some lessons, teacher picked by search.
- **Messages**: every change shows a toast at the top (`core/toast.interceptor.ts` + `core/toast.service.ts`): green "Done" + one plain sentence, red "Not done" + the reason. No inline success/error boxes in pages; add new endpoints' wording to the `DONE` table in the interceptor.
- **Activity per page**: there is no separate log page. Each page carries `<app-page-log>` (`shared/page-log.ts`) filtered to what the page is about.
- Teacher file (`pages/admin/teacher-detail.ts`) is tabbed: Overview, Students, Attendance, Personal details, Pay & bank (admins), Notes, Activity. Keep new teacher data in a tab, not loose on the page.
- Times: weekly slots are on the student's clock; teachers' hours and the academy run on Cairo time. Always show the student's time with Cairo underneath.
- Trial lessons: free, 30 or 60 min, no invoice; the teacher is paid their hourly rate like any lesson.
- **Unpaid invoices** (`billing/unpaid.service.ts`, rules in `rules/billing.ts`: `unpaidStep`, `countsAsTaken`, `UNPAID_GRACE_LESSONS = 2`): the student is told at the last lesson of a cycle, then with each of the first two lessons of the unpaid cycle (bell + email). After the second lesson (or when the cycle ends) the rest of the cycle's lessons are removed (`cancelReason = UNPAID`) and the subscription waits (`PAUSED` + `heldForInvoiceId`). Marking the invoice paid brings back the lessons still ahead (when the time is still free) and turns the missed ones into credits. No new cycle opens on top of an unpaid one. A family that leaves: void + reissue with `billLessons` = lessons taken.
- **Payments**: marking paid records method, reference, the day the money arrived and a staff note (`PAYMENT_METHODS`). Only an admin takes a payment back (`POST /invoices/:id/unpay`, with a reason). Money actions always go through a locked row (`for update`) inside one transaction with the log entry.
- **Bell** (`notifications/`, `shared/bell.ts`): `NotificationsService.notify(tx, userId, {...})` / `notifyStaff(tx, area, {...})`; `dedupKey` stops a job from repeating itself. In-app only for now (no WhatsApp).
- Teachers see their own hours **and** expected pay in "Your month" (their rate only, never other teachers').
- Lessons are on Zoom (the field stays "Meeting link").
- Brand: green `#1D6A50`, gold `#F2B53A`, font Plus Jakarta Sans. Tokens in `apps/web/src/styles.scss`.

## Changing the database

1. Edit `apps/api/src/db/schema.ts`.
2. `npx drizzle-kit generate --name what-changed` (from `apps/api`, with `DATABASE_URL` set) writes `drizzle/00NN_what-changed.sql`.
3. Add a one-line comment at the top of the SQL and any data backfill at the end.
4. Tell Moaaz to run `npm run db:migrate` (from `apps\api`) after pulling.

## Working from more than one device or Claude account

- The code lives in a **private GitHub repo**. Before starting: `git pull`. When done and tests pass: commit, then `git push`. Never work on the same files from two places at once.
- Never commit secrets: `apps/api/.env` (copy it by hand to each device), no passwords or bank numbers in code, tests or docs.
- Keep this file, `README.md` and `docs/ROADMAP.md` up to date at the end of each piece of work: they are how the next session (any device, any account) knows where things stand.
