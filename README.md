# Brightverse Academy LMS

<img src="docs/brand/brightverse-logo.svg" alt="Brightverse Academy" width="260">

Admin, teacher and student dashboards for Brightverse Academy, an online academy: one-to-one lessons, 28-day prepaid cycles, self-service cancel and reschedule with quotas, attendance through "Enter class", and a full activity log.

```
apps/
  api/   NestJS 12 + Drizzle ORM + PostgreSQL   (REST API under /api)
  web/   Angular 22                               (the three dashboards)
docker-compose.yml   local PostgreSQL
docs/brand/          logo files and colors
```

## Run it locally

You need **Node.js 24 LTS** and **Docker Desktop** (or any PostgreSQL 16+). On Windows, run the commands in PowerShell (`cp` works there; in the old Command Prompt use `copy`).

```bash
docker compose up -d          # PostgreSQL on localhost:5432 (user/pass/db: lms)
npm run setup                 # installs both apps

cd apps/api
cp .env.example .env
npm run db:migrate            # creates the tables
npm run build && npm run db:seed   # demo data
npm run start:dev             # API on http://localhost:3000/api

# second terminal
cd apps/web
npm start                     # http://localhost:4200 (proxies /api to :3000)
```

If something doesn't start:

- **"Something went wrong" on the sign-in page**: the web app can't reach the API. Open http://localhost:3000/api/health: it should say `{"ok":true}`. If it doesn't load, look at the API's terminal.
- **`ECONNREFUSED ...:5432` in the API's terminal**: the database isn't running. Start Docker Desktop and wait until it says "Engine running", then `docker compose up -d` again (or start your own PostgreSQL and put its address in `apps/api/.env`).
- **"The Angular CLI requires a minimum Node.js version"**: install Node.js 24 LTS from nodejs.org, close the terminal, open a new one and check with `node -v`.
- **Windows, "'cp' is not recognized"**: use `copy .env.example .env` in the Command Prompt.

Demo accounts (password `ChangeMe123!` for all, change before going live):

| Role | Email |
| --- | --- |
| Admin | admin@academy.local |
| Staff | staff@academy.local |
| Teachers | ahmed@ / mona@ / khaled@academy.local |
| Students | omar@ (New York) / aisha@ (Sydney) / mariam@ (New York) / youssef@academy.local (London) |

Omar joined one cycle (28 days) ago, so his account has history: attended lessons with notes and homework, one lesson he cancelled (a credit on his current invoice), a paid invoice, and one past lesson still waiting for the teacher's notes.

Youssef (`youssef@academy.local`, London, Premium with Mona) also joined a cycle ago. His past lessons show every attendance case for staff to check: one he missed, one his teacher did not enter, one nobody entered, plus an extra lesson billed on his paid invoice.

## What each dashboard can do

**Admin and staff** (`/admin`)

- Today: every lesson of the day with its status; cancel or move any lesson.
- Students: add a student (an account is created with a temporary password), edit, reset the password, turn sign-in off. Admins can import many students (or teachers) from Excel or a CSV: each row is checked first (missing or wrong email, unknown time zone or curriculum, duplicates), then all the accounts are created at once and their passwords can be downloaded.
- Students: add a student in a pop-up (name, email, phone, country, time zone, address); lessons can wait. An Actions menu on every student and teacher row (profile, calendar, add a lesson, reschedule, cancel, transfer, reset password). "Add a lesson" goes step by step: what kind (one lesson, every week, free trial), with which teacher (theirs or another: one lesson with a stand-in, or new weekly lessons next to the current ones), then curriculum and time; the plan follows the hours. "Transfer" only moves lessons: for good (all upcoming lessons and the weekly times) or some lessons picked from a list, to a teacher found by name. The reschedule/cancel dialog asks who asked (or why), shows the teacher's free times by morning, afternoon and evening, and what the change counts toward. The student's page shows contact details and their teacher's meeting link to copy. Ctrl+K finds anyone.
- Free trial lesson: one lesson of 30 or 60 minutes with any teacher of the curriculum, no subscription and no invoice; cancelling it gives no credit.
- Lessons page: every lesson by kind (regular, trial, extra and makeup, cancelled, rescheduled) with dates, teacher and student filters; each lesson has its own page (people, link, who entered when, history, invoice, credit or charge, and its log).
- Website applications (Requests → Website applications): the site posts to `/api/public/applications` (JSON or a plain form, no sign-in; a hidden field and a per-address limit keep spam out; a form may redirect back to a page on an address in `CORS_ORIGINS`). Staff see each application, add notes, mark it contacted or not going ahead, and add the person as a student in one step. A ready form for the website is in `docs/website-form.html`. The academy's PHP website forwards its own contact form server-to-server (set `APPLICATIONS_KEY` here and the same key plus this address in the site's /admin → إشعارات الطلبات; a request with header `X-Site-Key` matching it skips the per-address limit).
- New subscription: curriculum, weekly times (add or remove days freely; the plan follows the hours: the biggest plan whose hours they reach), teacher (same level first; a lower level needs an override), weekly times on the student's clock with the Cairo time next to each. The teacher's free weekly times are listed (free every week of the first cycle, clock changes included); a click fills the next lesson. Creates cycle 1, its lessons and the prepaid invoice.
- Manage subscription: change plan or weekly times (from the next cycle), move all upcoming lessons to another teacher, add an extra lesson (billed at the plan price) or a makeup (free, and it can say which owed lesson it replaces), picking from the teacher's free times that day (night times for the student, 11 PM to 7 AM, are hidden unless asked for), pause (upcoming lessons become credits).
- Teacher file: the essentials on top (level, status, active students, lessons held and cancelled this month, no-shows in 6 months), then tabs: Overview (curricula, meeting link, languages, experience, latest notes, weekly hours), Students (who, curriculum, plan, weekly times, since), Attendance (6 months: held, student absent, teacher did not come, cancelled by the teacher, nobody came; and each incident with its makeup), Personal details (contact, gender, date of birth, country, city, address, languages, education, experience, joined), Pay & bank (admins only: rate, paid months, bank / InstaPay / wallet with the numbers hidden until shown; the log records what changed, never the numbers), Notes (staff notes; the writer or an admin removes one) and Activity. Lessons are moved and cancelled from the student's side only.
- Teachers: add a teacher with level, meeting link (Zoom or Google Meet) and the curricula they teach; set weekly hours (Cairo time); edit, reset the password, turn sign-in off; each teacher's cancellations this month (4 allowed) and, for admins, their pay per hour. Admins set pay per hour for each level (Premium, Standard, Basic) above "Lessons to pay"; a teacher with their own rate keeps it, everyone else gets their level's rate. "Lessons to pay" counts each teacher's paid lessons and hours per month (held, or the student was absent), the ones not paid, and the ones still to check, admins also see each teacher's rate and pay (hours x rate) and the month's total, and record a month as paid (the amount is kept as it was that day; paying before the month is over or with lessons still to check needs an override). Each teacher's page lists the months paid. Staff never see pay, in the app or in the log.
- Requests: when a student can't cancel or move a lesson online (too late, or no quota left), or a teacher needs a change, they send a request with a message. Staff see why it was blocked online and answer in one step: approve (the lesson is cancelled or moved right away, with the outcome they choose) or decline with a reply. The menu shows how many are waiting.
- Invoices: search by student, email or number, filter by status and issue date; mark paid; void (admin only, with a reason), optionally issuing a new invoice for the same cycle at today's price, with the credits and extra lessons moved onto it; open any invoice as a printable page with the logo (or save as PDF); download invoices and lessons for a date range as CSV for accounting.
- Unpaid invoices: an invoice is due on the first day of its cycle. The student is told at the last lesson of the cycle before, then with each of the first two lessons of the unpaid cycle (bell and email). After the second lesson, or when the cycle ends, the remaining lessons are removed and the subscription waits; the invoice list shows "Overdue" and "Lessons on hold". Marking it paid puts the lessons still ahead back (when the time is still free) and turns the missed ones into credits on the next invoice. No new cycle opens on top of an unpaid one. For a family that does not come back, void the invoice and issue a new one for the lessons taken only.
- Recording a payment asks how it was paid (bank transfer, InstaPay, wallet, card, PayPal, cash, other), the reference, the day the money arrived and an optional staff note; the invoice shows them. An admin can take a payment back with a reason.
- The bell (all three dashboards): each person's own notices (payment due, lessons on hold, lessons back, payment received), unread count, opens the page it is about.
- Reports: one month in numbers (Cairo days): money invoiced, collected and still due, voided invoices; lessons held, student absent, nobody came, cancelled (by whom), moved, extra and makeup, still to check; active students and who started; for admins, teacher pay earned against what was recorded as paid; and the last six months of money collected and lessons held; download the month as CSV. Admins and staff with Invoices.
- Curricula & plans: add or turn off curricula, each with its PDF books (up to 30 MB; teachers and students of the curriculum read them under Books); plans (admin only): hours per 28-day cycle (the step where a subscription moves to this plan) and lesson length, price per lesson, cancel and reschedule quotas.
- Staff & roles (admin only): add staff or admins, change roles, reset passwords, turn sign-in off. There is always at least one active admin. Each staff member can be limited to some areas: students, teachers, lessons & requests, invoices, curricula, activity log (all by default). Everyone on the staff can still look up students, teachers and lessons; the menu hides what they can't use and the API refuses it. Changes apply within seconds, without signing in again.
- Activity on every page (no separate log page): a student's page shows everything about them (their lessons, weekly lessons, invoices, sign-in), a teacher's page theirs, an invoice or a subscription its own history, and the list pages their kind of action (Students, Teachers, Lessons, Requests, Invoices, Curricula & plans, Staff, Reports; Today shows the latest of all). Newest first, Cairo time, who did it, what changed, "Show older" for more; overrides are highlighted and say which rule was set aside. Staff see it when "Activity" is among their areas. API: `GET /audit-logs?studentId=|teacherId=|entityType=&entityId=|actions=lesson.,homework.`.
- Messages after every action: a green "Done" at the top of the screen saying what was done ("Lesson moved.", "Invoice marked as paid."), or a red "Not done" with the reason in plain words. They go by themselves (a failure stays longer) and sit above open dialogs.
- Students and teachers lists: search by name or email; filter students by status, plan and teacher, teachers by level and curriculum. Each student and teacher has a month calendar of their lessons.
- Today shows the academy at a glance: active students, unpaid and overdue invoices, open requests, lessons in the next 7 days, held lessons still missing notes, and attendance to check.
- Schedule check (on Today, when there is something to act on or a clock change within two weeks): upcoming lessons outside the teacher's hours or on top of another lesson, each with a Change button, and the clock changes coming up in Egypt and in the students' countries. Saving a teacher's hours also says how many booked lessons no longer fit.
- Attendance to check (on Today): finished lessons where someone did not press Enter class. Staff say what happened in one click: student absent, it was held, nobody came, or the teacher was absent (the student gets a makeup or a credit). Makeups still to book are listed under it, each with a link that opens the booking form with the lesson filled in.

When a rule blocks something, the screen says why. Staff can go ahead anyway; nobody writes a note: the log records the action and the rule that was set aside.

**Teachers** (`/teacher`): ask the academy to cancel or move a lesson and see the answer (teachers do not cancel directly: the academy decides between a makeup and a credit), today's next lesson with Enter class, what's coming up, a month calendar on Cairo time, past lessons with a filter for the held ones still missing notes and a "Your month" summary (lessons that count for them, hours, and what they come to at their own rate, or the amount the academy recorded as paid; any month), notes and homework for any lesson, "Homework to check" on Today with the answers students sent and their files (reply on the lesson page; the student gets an email), whether a past lesson counts for them, and which lessons are at a different Cairo time because the clocks change.

**Students** (`/student`): ask the academy when a change isn't allowed online and see the answer, next lesson with Enter class, reschedule into the teacher's free times (up to 4 weeks ahead, also into the next cycle), cancel within the plan's quota and the 4-hour notice, the newest homework on the home page, every past lesson with the teacher's notes and homework, send a homework answer with up to 3 photos, PDFs or voice recordings (8 MB each, kept in the database; it can be changed until the teacher replies) and read the reply, their invoices (what is due, what is paid, printable), a month calendar where each lesson opens its page, and how many changes are left this cycle.

All three have Settings (name, phone, password) and "Forgot your password?" on the sign-in page (an emailed link). Admins also see there whether email is on and the latest emails, and write "How families pay" (bank account, InstaPay, a payment link…), which every unpaid invoice and the new-invoice email show.

## Where the business rules live

All rules are plain functions in `apps/api/src/rules/`, so they are easy to read and test:

| Rule | File |
| --- | --- |
| 4-hour notice, cancel/reschedule quotas, what a cancel means for billing, teachers' 4 cancellations a month | `lesson-rules.ts` |
| Teacher level vs plan (higher allowed, lower needs an admin override) | `lesson-rules.ts` |
| "Enter class" window; after the lesson: who came, what counts, whether the teacher is paid, what staff can record | `lesson-rules.ts` |
| 28-day cycles, lessons a week → plan by hours, invoice = lessons/week x 4 + extra lessons - credits | `billing.ts` |
| Time zones: weekly slots fixed to the student's clock, availability on the teacher's (Cairo) | `schedule.ts` |
| Clock changes ahead, how far a lesson moves on the Cairo clock, lessons outside hours or clashing | `clock.ts` |

Other decisions built in:

- A lesson is never edited or deleted when it moves. It becomes `RESCHEDULED` and the new lesson points back to it (`origin_lesson_id`).
- Staff can go past any rule with `override: true`; the log marks it as an override and names the rules ("Overrode: …").
- Every change is written to `audit_logs` in the same transaction.
- An hourly job opens the next cycle (lessons + prepaid invoice) on the last day of the current one.
- Every 10 minutes a job settles lessons that ended at least 5 minutes ago (`CLOSE_AFTER_END_MIN`), from the Enter class presses:

  | Who entered | Lesson | Student | Teacher paid | Staff |
  | --- | --- | --- | --- | --- |
  | both | completed | counted | yes | nothing to do |
  | teacher only | completed (student absent) | counted, pays as normal | yes | notice to confirm |
  | student only | waits | waits | no, until staff decide | decide what happened |
  | nobody | waits | waits | no, until staff decide | decide what happened |

  Staff then record one of: held (counted, paid), student absent (counted, paid), nobody came (counted, not paid), or teacher absent (cancelled by the teacher, not paid, and the student gets a makeup or a credit).

Decided with the academy:

- Plans are steps by hours: under 8 hours a cycle is Basic, 8 to under 12 Standard, 12 or more Premium (with hour-long lessons: 1 a week Basic, 2 Standard, 3+ Premium). Adding or removing a weekly day moves the plan automatically. Premium gets the top teachers (Premium level) and unlimited cancels and reschedules; Standard 2 and 2; Basic 1 and 1. The 4-hour notice applies to every plan.
- A teacher can cancel 4 lessons a month (Cairo calendar month of the lesson); lessons they did not come to count too. After that the teacher cannot ask, and staff can cancel only with an override (the log names the rule).
- Teachers are paid per hour: their level's rate (Premium, Standard, Basic), unless the teacher has their own rate. Nobody came = counted for the student (unless they cancelled in time), not paid to the teacher.

- Teachers cannot cancel a lesson themselves; they ask, and the academy chooses a makeup lesson or a credit off the next invoice. A chosen makeup stays on the "Makeups to book" list until it is booked.
- Students can reschedule into any free time of their teacher up to 4 weeks ahead, also into the next billing cycle. The lesson stays on its original invoice.
- An extra lesson (not a makeup) costs the plan price: it goes on the current cycle's invoice while it is unpaid, otherwise on the next invoice.
- "Enter class" opens 10 minutes before (`ENTER_CLASS_OPENS_MIN_BEFORE`).

## Tests

```bash
cd apps/api && npm test          # rules: quotas, 4-hour rule, cycles, daylight saving and clock changes, attendance, free weekly times, sign-in limits
cd apps/web && npm test          # dates and time zones, month grid, rule messages

# The API against a real database. It WIPES the database it points at.
cd apps/api && TEST_DATABASE_URL=postgresql://lms:lms@localhost:5432/lms_test npm run test:e2e
```

The API end-to-end tests are three suites: the main flow (subscriptions, cancels, moves, billing, staff), requests, and an access matrix that tries every role against everyone else's data.

### Browser tests (Playwright)

`apps/web/e2e/` drives the real app in Chromium: sign-in and roles, an admin adding a teacher, their hours, a student and a subscription (including the rule that blocks times outside the teacher's hours), pausing, turning off a staff member's sign-in, a student rescheduling and cancelling within their quota, a student reading past notes and homework, a teacher saving notes and catching up on lessons without notes, calendars opening each lesson, asking the academy and getting an answer, searching and filtering the lists, every main page fitting a phone screen, and automatic accessibility checks (axe, WCAG 2.1 AA rules) on every page.

```bash
(cd apps/web && npx playwright install chromium)    # once
npm run test:ui                                      # builds both apps, then runs the tests
npm --prefix apps/web run e2e:report                 # open the HTML report
```

The tests start the API on port 3100 against `lms_ui_test`, which is **wiped and re-seeded on every run** (the reset script refuses any database whose name doesn't end in `_test`). Override with `UI_TEST_DATABASE_URL` and `UI_TEST_PORT`.

`docker compose` creates `lms_test` and `lms_ui_test` on first start. If your database volume already existed before, create the second one yourself:

```bash
docker compose exec db psql -U lms -c "CREATE DATABASE lms_ui_test;"
```

### Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request: API lint, unit tests, web unit tests, both builds, the API end-to-end tests on a PostgreSQL service, and the browser tests. The Playwright report is attached to each run (Actions → the run → Artifacts → `playwright-report`).

## Changing the database

1. Edit `apps/api/src/db/schema.ts`.
2. `npm run db:generate -- --name what-changed` writes a SQL migration to `apps/api/drizzle/`.
3. `npm run db:migrate` applies it. Commit the migration with the code.

`npm run db:studio` opens a browser view of the data.

## Deploy (Railway, one service + PostgreSQL)

Railway builds the repo's `Dockerfile` by itself. The image applies the database migrations, then serves the API and the web app on `PORT` (3000 unless Railway sets another). Leave the build and start commands empty.

1. Push the repo to GitHub. In Railway: New Project → Deploy from GitHub repo → pick it.
2. In the same project: New → Database → PostgreSQL.
3. On the app service, Variables:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (Railway fills in the database's address)
   - `JWT_SECRET` = 32+ random characters (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`)
   - `TRUST_PROXY` = `1`
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD` (12+ characters), `ADMIN_NAME`: the first admin account, created on the first start
   - `APP_URL` = the address people open (for links in emails), and for email: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (see below)
4. Settings → Networking → Generate Domain (if it asks for a port: `3000`, the image's default when `PORT` is not set). Settings → Deploy → Healthcheck Path: `/api/health`.
5. Open the domain and sign in with the admin email and password. Then delete `ADMIN_PASSWORD` from the variables; nothing else changes (the account is only ever created when there is no admin).

Do not run the seed on a real deployment: the demo accounts share a known password.

The deploy log shows `Created the first admin account` on the first start. If it shows a problem instead (for example a password that is too short), fix the variable and redeploy.

## Email

The system emails a link when someone forgets their password, a reminder about an hour before each lesson (to the student on their clock and the teacher on Cairo's), and each new invoice to the student. Emails go into an outbox in the same database change and a job sends them within a minute; failed ones are tried 3 times.

Without `SMTP_HOST` nothing is sent and the admin's **Settings** page says email is off (with the latest messages that were not sent). To turn it on, set these on the server and restart:

| Variable | Example |
| --- | --- |
| `SMTP_HOST` | `smtp.zoho.com`, `smtp-relay.brevo.com`, `smtp.gmail.com`, `smtp.resend.com` |
| `SMTP_PORT` | `587` (or `465`) |
| `SMTP_USER`, `SMTP_PASS` | the account's SMTP user and password (an app password for Gmail) |
| `MAIL_FROM` | `Brightverse Academy <hello@brightverseacademy.com>` |
| `APP_URL` | `https://app.brightverseacademy.com` |

Send from an address on your own domain and add the provider's SPF and DKIM records to the domain, or emails land in spam. Then use **Send a test email** on the Settings page.

## Brand

Logo files, colors and fonts are in `docs/brand` (with a short guide). The app uses the green `#1D6A50` and the gold `#F2B53A`; the logo in the app and on invoices comes from `apps/web/public/brand`.

## API documentation

- While developing: Swagger UI at http://localhost:3000/api/docs (sign in with `POST /api/auth/login`, copy `accessToken`, press **Authorize**). In production it is off unless `API_DOCS=1`.
- `docs/openapi.json` is the same description as a file. In **Postman**: Import → choose the file → it becomes a collection with every route and request body. Set a collection variable `baseUrl` and a Bearer token.
- Request bodies come straight from the validation rules, so the docs can't drift. After changing the API: `npm --prefix apps/api run build && npm --prefix apps/api run docs:export` (CI fails if you forget).

## Security

- Sign-in: 5 wrong passwords for one email (or 30 from one address) pause sign-in for 15 minutes; the pause is written to the activity log. An unknown email and a wrong password get the same answer in about the same time.
- Every page and API answer carries security headers (content security policy, no framing, no MIME sniffing).
- In production the server refuses to start with a short or placeholder `JWT_SECRET`.
- Turning a person's sign-in off or changing their role takes effect within about 15 seconds, even on tokens already issued.
- Unknown fields in a request body are refused, so nobody can set their own role or level.
- CSV downloads are logged, and cells that would start a spreadsheet formula are kept as text.
- Every API request gets an id (the `X-Request-Id` header, also shown in error answers) and one JSON log line: method, path without the query string, status, time, user. `LOG_REQUESTS=0` turns the lines off.
- `apps/api/test/access.e2e-spec.ts` checks every role against everyone else's data: lessons, students, teachers, subscriptions, invoices, staff, the log and requests.

## Run it with Docker (any host)

The `Dockerfile` builds one image with the API and the web app; on start it applies the migrations, then serves on port 3000.

```bash
docker build -t academy-lms .
docker run -p 3000:3000 -e DATABASE_URL=postgresql://... -e JWT_SECRET=<32+ random characters> -e TRUST_PROXY=1 academy-lms
```

Or the whole system locally, database included:

```bash
JWT_SECRET=$(openssl rand -base64 32) docker compose --profile app up --build   # http://localhost:3000
docker compose exec app node dist/db/seed.js                                     # demo data, if you want it
```

## API at a glance

All routes are under `/api` and need `Authorization: Bearer <token>` except login and health.

| Method | Route | Who |
| --- | --- | --- |
| POST | `/auth/login`, GET/PATCH `/auth/me`, POST `/auth/password` | everyone |
| GET/POST | `/curricula` (+ PATCH `/:id`) | read: all, write: staff |
| GET/POST | `/plans` (+ PATCH `/:id`) | read: all, write: admin |
| GET/POST/PATCH | `/teachers`, PUT `/teachers/:id/availability` | staff |
| GET | `/teachers/:id/weekly-free?timezone=&startDate=&durationMin=` | staff |
| GET/POST/PATCH | `/staff` | admin |
| POST | `/users/:id/password`, `/users/:id/active` | staff (admin for staff accounts) |
| GET/POST/PATCH | `/students`, GET `/students/:id/overview` | staff, student (own) |
| POST/GET/PATCH | `/subscriptions`, POST `/:id/transfer`, `/:id/pause` | staff |
| GET | `/lessons?from=&to=&order=desc&limit=`, `/lessons/today`, `/lessons/:id`, `/lessons/:id/free-slots?date=` | scoped by role |
| POST | `/lessons/:id/enter`, `/cancel`, `/reschedule` | scoped by role |
| POST | `/lessons/:id/transfer`, `/lessons/extra` | staff |
| GET | `/lessons/attendance-review`, `/lessons/makeups-owed?studentId=`, `/lessons/schedule-check?days=` | staff |
| POST | `/lessons/:id/attendance` (what happened: `CONFIRM`, `HELD`, `STUDENT_ABSENT`, `NOBODY_CAME`, `TEACHER_ABSENT`) | staff |
| PATCH | `/lessons/:id/notes` | teacher (own), staff |
| GET/POST | `/invoices`, `/invoices/:id`, `/invoices/:id/pay` | staff, student (own, read) |
| GET | `/exports/invoices.csv?from=&to=`, `/exports/lessons.csv?from=&to=` | staff |
| GET | `/stats/overview`, `/stats/teacher-lessons?from=&to=` (lessons to pay per teacher) | staff |
| POST | `/invoices/:id/void` | admin |
| POST | `/requests` (ask to cancel or move), `/requests/:id/withdraw` | student, teacher (own lessons) |
| GET | `/requests?status=OPEN\|CLOSED`, `/requests/summary` | staff: all, others: own |
| POST | `/requests/:id/approve`, `/requests/:id/decline` | staff |
| GET | `/audit-logs?q=&actorKind=&action=&from=&to=&limit=` | staff |

A blocked action returns `422` with `violations` and `canOverride`. When one action touches many lessons, each violation also has `at` (the lesson time in Cairo).
