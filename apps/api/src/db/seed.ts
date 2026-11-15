/**
 * Demo data so every dashboard has something to show.
 * Run after migrations:  npm run build && npm run db:seed
 * All demo accounts use the password below. Change or delete them before going live.
 */
import { NestFactory } from '@nestjs/core';
import { and, asc, eq, lte, ne } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { AppModule } from '../app.module.js';
import { hashPassword } from '../auth/auth.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CyclesService } from '../billing/cycles.service.js';
import { AttendanceService } from '../lessons/attendance.service.js';
import { LessonsService } from '../lessons/lessons.service.js';
import { localDateOf } from '../rules/schedule.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import { DB, type Db } from './db.module.js';
import {
  availabilityWindows,
  billingCycles,
  curricula,
  emailOutbox,
  applications,
  invoices,
  levelPayRates,
  lessons,
  plans,
  students,
  teacherCurricula,
  teacherBankDetails,
  teacherNotes,
  teachers,
  users,
  type Tier,
} from './schema.js';

const DEMO_PASSWORD = 'ChangeMe123!';

/** What Omar's teacher wrote after each past lesson. The last attended lesson has no notes yet, on purpose. */
const HISTORY: {
  notes: string;
  homeworkTitle: string;
  homeworkBody: string;
  /** Omar's answer, and his teacher's reply when checked */
  answer?: string;
  feedback?: string;
}[] = [
  {
    notes:
      'First lesson. Placement check and goals for the course. Omar reads short words well; long vowels need work.',
    homeworkTitle: 'Unit 1 vocabulary',
    homeworkBody:
      'Learn the 12 words on page 4.\nRecord yourself reading them and bring the recording next lesson.',
  },
  {
    notes:
      'Unit 1: greetings and introductions. Good listening; practised long vowels for 10 minutes.',
    homeworkTitle: 'Workbook page 6',
    homeworkBody:
      'Exercises 1 to 3. Exercise 3 is a short dialogue: read it aloud twice.',
    answer:
      'Exercise 1: done. Exercise 2: b, a, c, a. I read the dialogue twice with my sister.',
    feedback:
      'Well done, Omar. Exercise 2 is all correct. Next time, record the dialogue so I can hear your long vowels.',
  },
  {
    notes:
      'Reviewed the recording homework. Unit 2: numbers 1-20 and telling your age.',
    homeworkTitle: 'Numbers practice',
    homeworkBody:
      "Write the numbers 1 to 20 in words.\nSay your family members' ages out loud.",
  },
  {
    notes:
      'Unit 2 continued: days of the week. Quiz on unit 1 words: 10 of 12 right.',
    homeworkTitle: 'Days of the week',
    homeworkBody: 'Workbook page 9, exercises 1 and 2.',
  },
  {
    notes:
      'Unit 3: my family. Omar described a family photo in 5 sentences with little help.',
    homeworkTitle: 'Describe a photo',
    homeworkBody:
      'Write 5 sentences about a photo of your family. Send a photo of your page to the teacher.',
    answer:
      'This is my family. My father is tall. My mother is kind. My brother is 8 years old. We are in the park.',
  },
  {
    notes:
      'Corrected the family sentences together. Started reading the unit 3 story.',
    homeworkTitle: 'Finish the story',
    homeworkBody:
      'Read the rest of the unit 3 story (page 14) and underline new words.',
  },
];
const h = (hour: number) => hour * 60;

/**
 * Youssef's first cycle shows every attendance case. Indexes are his regular
 * lessons in time order; "both" lessons get short notes.
 */
const YOUSSEF: ('both' | 'teacher' | 'student' | 'none')[] = [
  'both',
  'both',
  'both',
  'teacher',
  'both',
  'both',
  'student',
  'both',
  'both',
  'none',
  'both',
  'both',
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const db = app.get<Db>(DB);
  const subs = app.get(SubscriptionsService);
  const lessonsService = app.get(LessonsService);
  const cycles = app.get(CyclesService);

  const [already] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'admin@academy.local'));
  if (already) {
    console.log('Demo data is already there. Nothing to do.');
    await app.close();
    return;
  }
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const [admin] = await db
    .insert(users)
    .values([
      {
        email: 'admin@academy.local',
        fullName: 'Academy Admin',
        role: 'ADMIN',
        passwordHash,
      },
      {
        email: 'staff@academy.local',
        fullName: 'Dina',
        role: 'STAFF',
        passwordHash,
      },
    ])
    .returning();
  const actor: AuthUser = {
    userId: admin.id,
    role: 'ADMIN',
    fullName: admin.fullName,
    timezone: admin.timezone,
  };

  // Price per lesson (one hour), as on the website: Basic $45, Standard $80 and
  // Premium $108 every 4 weeks. Change them from the admin side.
  const planRows = await db
    .insert(plans)
    .values([
      // 12, 8 and 4 hours a cycle of 60-minute lessons: 3, 2 and 1 a week.
      {
        name: 'Premium',
        tier: 'PREMIUM',
        priceCents: 900,
        cancelQuota: null,
        rescheduleQuota: null,
        hoursPerCycle: 12,
      },
      {
        name: 'Standard',
        tier: 'STANDARD',
        priceCents: 1000,
        cancelQuota: 2,
        rescheduleQuota: 2,
        hoursPerCycle: 8,
      },
      {
        name: 'Basic',
        tier: 'BASIC',
        priceCents: 1125,
        cancelQuota: 1,
        rescheduleQuota: 1,
        hoursPerCycle: 4,
      },
    ])
    .returning();
  const plan = (tier: Tier) => planRows.find((p) => p.tier === tier)!;

  const cur = await db
    .insert(curricula)
    .values([
      { name: 'Foundations 1' },
      { name: 'Foundations 2' },
      { name: 'Reading 1' },
    ])
    .returning();
  const curriculum = (name: string) => cur.find((c) => c.name === name)!;

  async function teacher(
    email: string,
    fullName: string,
    level: Tier,
    curriculumNames: string[],
    windows: { weekday: number; startMinute: number; endMinute: number }[],
  ) {
    const [u] = await db
      .insert(users)
      .values({ email, fullName, role: 'TEACHER', passwordHash })
      .returning();
    const [t] = await db
      .insert(teachers)
      .values({
        userId: u.id,
        level,
        zoomLink: `https://zoom.us/j/${Math.floor(1e9 + Math.random() * 9e9)}`,
      })
      .returning();
    await db.insert(teacherCurricula).values(
      curriculumNames.map((n) => ({
        teacherId: t.id,
        curriculumId: curriculum(n).id,
      })),
    );
    await db
      .insert(availabilityWindows)
      .values(windows.map((w) => ({ ...w, teacherId: t.id })));
    return t;
  }

  // Availability is on the teacher's clock (Cairo). ISO weekdays: 1 Mon ... 6 Sat, 7 Sun.
  const ahmed = await teacher(
    'ahmed@academy.local',
    'Ahmed Hassan',
    'STANDARD',
    ['Foundations 1', 'Foundations 2', 'Reading 1'],
    [
      { weekday: 6, startMinute: h(9), endMinute: h(13) },
      { weekday: 6, startMinute: h(17), endMinute: h(23) },
      { weekday: 1, startMinute: h(14), endMinute: h(24) },
      { weekday: 2, startMinute: h(9), endMinute: h(12) },
      { weekday: 2, startMinute: h(15), endMinute: h(23) },
      { weekday: 3, startMinute: h(14), endMinute: h(24) },
      { weekday: 4, startMinute: h(9), endMinute: h(12) },
      { weekday: 4, startMinute: h(15), endMinute: h(23) },
      { weekday: 5, startMinute: h(15), endMinute: h(20) },
    ],
  );
  const mona = await teacher(
    'mona@academy.local',
    'Mona Fathy',
    'PREMIUM',
    ['Foundations 1', 'Foundations 2', 'Reading 1'],
    [6, 7, 1, 2, 3, 4].map((weekday) => ({
      weekday,
      startMinute: h(9),
      endMinute: h(23),
    })),
  );
  const khaled = await teacher(
    'khaled@academy.local',
    'Khaled Samir',
    'BASIC',
    ['Foundations 1', 'Foundations 2'],
    [6, 7, 1, 2, 3, 4].map((weekday) => ({
      weekday,
      startMinute: h(12),
      endMinute: h(24),
    })),
  );
  // Their profiles: personal details, how they are paid, and a note or two.
  const profiles = [
    {
      t: ahmed,
      phone: '+20 100 123 4567',
      gender: 'MALE',
      birthDate: '1988-03-14',
      city: 'Cairo',
      address: 'Nasr City, Cairo',
      languages: 'Arabic, English',
      education:
        'BA in Arabic Language, Al-Azhar University · Ijazah in Hafs an Asim',
      experienceYears: 9,
      joinedOn: '2024-09-01',
      bank: {
        method: 'BANK',
        bankName: 'CIB',
        accountHolder: 'Ahmed Hassan Mahmoud',
        accountNumber: '100023456789',
        iban: 'EG380019000500000000263180002',
      },
      note: 'Families like his structured lessons. Prefers evening slots on weekdays.',
    },
    {
      t: mona,
      phone: '+20 122 765 4321',
      gender: 'FEMALE',
      birthDate: '1991-07-02',
      city: 'Alexandria',
      address: 'Smouha, Alexandria',
      languages: 'Arabic, English, French',
      education:
        'MA in Islamic Studies, Alexandria University · Ijazah in Hafs and Warsh',
      experienceYears: 11,
      joinedOn: '2023-02-15',
      bank: { method: 'INSTAPAY', instapay: 'mona.fathy@instapay' },
      note: 'Senior teacher: helps new teachers with their first trial lessons.',
    },
    {
      t: khaled,
      phone: '+20 111 222 3344',
      gender: 'MALE',
      birthDate: '1996-11-20',
      city: 'Giza',
      address: 'Dokki, Giza',
      languages: 'Arabic, English',
      education: 'BA in Education, Cairo University',
      experienceYears: 3,
      joinedOn: '2025-10-01',
      bank: { method: 'WALLET', wallet: '01001234567' },
      note: 'New this year. Check his lesson notes weekly for the first months.',
    },
  ];
  const [adminUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'ADMIN'))
    .limit(1);
  for (const { t, bank, note, phone, ...p } of profiles) {
    await db.update(users).set({ phone }).where(eq(users.id, t.userId));
    await db
      .update(teachers)
      .set({ ...p, country: 'EG' })
      .where(eq(teachers.id, t.id));
    await db.insert(teacherBankDetails).values({ teacherId: t.id, ...bank });
    await db
      .insert(teacherNotes)
      .values({ teacherId: t.id, authorId: adminUser?.id ?? null, body: note });
  }

  // Pay per hour by level (placeholders, like the plan prices). Teachers have
  // no rate of their own, so each is paid their level's rate.
  // Two applications from the website, to follow up.
  await db.insert(applications).values([
    {
      fullName: 'Hana Rahman',
      email: 'hana.rahman@example.com',
      phone: '+44 7700 900456',
      country: 'United Kingdom',
      timezone: 'Europe/London',
      curriculum: 'Quran reading for kids',
      preferredTimes: 'Saturday and Sunday mornings',
      studentAge: '8',
      message: 'My son can read the letters and wants to start reading.',
      source: 'https://www.brightverseacademy.com/apply',
    },
    {
      fullName: 'Daniel Brooks',
      email: 'daniel.brooks@example.com',
      phone: '+1 415 555 0199',
      country: 'United States',
      timezone: 'America/Los_Angeles',
      curriculum: 'Arabic for adults',
      preferredTimes: 'Weekday evenings after 7 PM',
      level: 'Beginner',
      source: 'https://www.brightverseacademy.com/apply',
      utm: 'utm_source=google&utm_campaign=arabic',
    },
  ]);

  await db.insert(levelPayRates).values([
    { level: 'PREMIUM', hourlyRateCents: 30000, currency: 'EGP' },
    { level: 'STANDARD', hourlyRateCents: 20000, currency: 'EGP' },
    { level: 'BASIC', hourlyRateCents: 15000, currency: 'EGP' },
  ]);

  async function student(email: string, fullName: string, timezone: string) {
    const [u] = await db
      .insert(users)
      .values({ email, fullName, role: 'STUDENT', timezone, passwordHash })
      .returning();
    const [s] = await db.insert(students).values({ userId: u.id }).returning();
    return { ...s, timezone };
  }
  const omar = await student(
    'omar@academy.local',
    'Omar Siddiqui',
    'America/New_York',
  );
  const aisha = await student(
    'aisha@academy.local',
    'Aisha Karim',
    'Australia/Sydney',
  );
  const mariam = await student(
    'mariam@academy.local',
    'Mariam Ali',
    'America/New_York',
  );
  const youssef = await student(
    'youssef@academy.local',
    'Youssef Nabil',
    'Europe/London',
  );

  const today = (tz: string) => localDateOf(new Date(), tz);

  // Weekly slots are on the STUDENT's clock.
  // Omar joined one cycle ago, so his history has lessons, notes and homework to show.
  const omarSub = await subs.create(actor, {
    studentId: omar.id,
    teacherId: ahmed.id,
    curriculumId: curriculum('Foundations 2').id,
    planId: plan('STANDARD').id,
    lessonsPerWeek: 2,
    startDate: DateTime.fromISO(today(omar.timezone))
      .minus({ days: 28 })
      .toISODate()!,
    slots: [
      { weekday: 2, startTime: '09:00' },
      { weekday: 4, startTime: '09:00' },
    ],
  });
  await pastCycleForOmar(
    omarSub.id,
    omarSub.cycleId,
    omarSub.invoiceId,
    omar.userId,
  );
  await subs.create(actor, {
    studentId: aisha.id,
    teacherId: mona.id,
    curriculumId: curriculum('Reading 1').id,
    planId: plan('PREMIUM').id,
    lessonsPerWeek: 3,
    startDate: today(aisha.timezone),
    slots: [
      { weekday: 1, startTime: '18:00' },
      { weekday: 3, startTime: '18:00' },
      { weekday: 6, startTime: '18:00' },
    ],
  });
  await subs.create(actor, {
    studentId: mariam.id,
    teacherId: khaled.id,
    curriculumId: curriculum('Foundations 1').id,
    planId: plan('BASIC').id,
    lessonsPerWeek: 1,
    startDate: today(mariam.timezone),
    slots: [{ weekday: 2, startTime: '13:00' }],
  });

  // Youssef also joined a cycle ago: his past lessons include a student absence,
  // a teacher who did not enter, a lesson nobody entered, and an extra lesson.
  const youssefSub = await subs.create(actor, {
    studentId: youssef.id,
    teacherId: mona.id,
    curriculumId: curriculum('Foundations 1').id,
    planId: plan('PREMIUM').id,
    lessonsPerWeek: 3,
    startDate: DateTime.fromISO(today(youssef.timezone))
      .minus({ days: 28 })
      .toISODate()!,
    slots: [
      { weekday: 7, startTime: '17:00' },
      { weekday: 1, startTime: '17:00' },
      { weekday: 3, startTime: '17:00' },
    ],
  });
  await pastCycleForYoussef(
    youssefSub.id,
    youssefSub.cycleId,
    youssefSub.invoiceId,
  );

  // Settle every finished lesson, as the job does every few minutes.
  await app.get(AttendanceService).closeEnded();

  async function pastCycleForYoussef(
    subscriptionId: string,
    cycleId: string,
    invoiceId: string,
  ) {
    const [cycle] = await db
      .select()
      .from(billingCycles)
      .where(eq(billingCycles.id, cycleId));
    const tz = youssef.timezone;
    // An extra Saturday lesson in the second week, booked while the invoice was still open.
    const start = DateTime.fromISO(cycle.startDate, { zone: tz });
    const saturday = start
      .plus({ days: ((6 - start.weekday + 7) % 7) + 7 })
      .set({ hour: 17 });
    await lessonsService.addExtra(
      actor,
      { subscriptionId, startsAt: saturday.toJSDate(), extraReason: 'OTHER' },
      saturday.minus({ days: 2 }).toJSDate(),
    );

    const past = await db
      .select()
      .from(lessons)
      .where(
        and(
          eq(lessons.subscriptionId, subscriptionId),
          eq(lessons.cycleId, cycleId),
        ),
      )
      .orderBy(asc(lessons.startsAt));
    const minute = 60_000;
    let regular = 0;
    for (const lesson of past) {
      const who =
        lesson.type === 'EXTRA' ? 'both' : (YOUSSEF[regular++] ?? 'both');
      const teacherIn = who === 'both' || who === 'teacher';
      const studentIn = who === 'both' || who === 'student';
      await db
        .update(lessons)
        .set({
          status: who === 'both' ? 'COMPLETED' : 'SCHEDULED',
          teacherJoinedAt: teacherIn
            ? new Date(lesson.startsAt.getTime() - 2 * minute)
            : null,
          studentJoinedAt: studentIn
            ? new Date(lesson.startsAt.getTime() + 1 * minute)
            : null,
          notes:
            who === 'both'
              ? `Lesson ${regular}: reading practice and new words.`
              : null,
        })
        .where(eq(lessons.id, lesson.id));
    }
    await db
      .update(invoices)
      .set({
        status: 'PAID',
        issuedAt: start.minus({ days: 1 }).set({ hour: 9 }).toJSDate(),
        paidAt: start.plus({ hours: 12 }).toJSDate(),
      })
      .where(eq(invoices.id, invoiceId));
    await db.transaction((tx) =>
      cycles.createCycle(tx, subscriptionId, 2, actor),
    );
    await attendedSoFar(subscriptionId, cycleId);
  }

  /**
   * A cycle-2 lesson that already ended (seeding late on one of the days) was
   * attended, so the cases to check stay the ones set up on purpose.
   */
  async function attendedSoFar(subscriptionId: string, firstCycleId: string) {
    const minute = 60_000;
    const ended = await db
      .select()
      .from(lessons)
      .where(
        and(
          eq(lessons.subscriptionId, subscriptionId),
          ne(lessons.cycleId, firstCycleId),
          eq(lessons.status, 'SCHEDULED'),
          lte(lessons.startsAt, new Date(Date.now() - 60 * minute)),
        ),
      );
    for (const lesson of ended)
      await db
        .update(lessons)
        .set({
          status: 'COMPLETED',
          teacherJoinedAt: new Date(lesson.startsAt.getTime() - 2 * minute),
          studentJoinedAt: new Date(lesson.startsAt.getTime() + 1 * minute),
        })
        .where(eq(lessons.id, lesson.id));
  }

  /** Cycle 1 is over: lessons attended with notes and homework, one cancelled by Omar, invoice paid. Then cycle 2 opens. */
  async function pastCycleForOmar(
    subscriptionId: string,
    cycleId: string,
    invoiceId: string,
    omarUserId: string,
  ) {
    const past = await db
      .select()
      .from(lessons)
      .where(
        and(
          eq(lessons.subscriptionId, subscriptionId),
          eq(lessons.cycleId, cycleId),
        ),
      )
      .orderBy(asc(lessons.startsAt));
    const omarUser: AuthUser = {
      userId: omarUserId,
      role: 'STUDENT',
      fullName: 'Omar Siddiqui',
      timezone: 'America/New_York',
      studentId: omar.id,
    };
    const minute = 60_000;
    let n = 0;
    for (const [i, lesson] of past.entries()) {
      if (i === 4) {
        // Cancelled by Omar a day ahead: inside his quota, so it becomes a credit on cycle 2.
        await lessonsService.cancel(
          omarUser,
          lesson.id,
          {},
          new Date(lesson.startsAt.getTime() - 26 * 60 * minute),
        );
        continue;
      }
      const note = HISTORY[n++] ?? {
        notes: null,
        homeworkTitle: null,
        homeworkBody: null,
      };
      await db
        .update(lessons)
        .set({
          status: 'COMPLETED',
          teacherJoinedAt: new Date(lesson.startsAt.getTime() - 3 * minute),
          studentJoinedAt: new Date(lesson.startsAt.getTime() + 2 * minute),
          notes: note.notes,
          homeworkTitle: note.homeworkTitle,
          homeworkBody: note.homeworkBody,
          // Answers come the next day; replies a day after that (never in the future).
          ...('answer' in note && note.answer
            ? {
                homeworkAnswer: note.answer,
                homeworkSentAt: new Date(
                  Math.min(
                    lesson.startsAt.getTime() + 20 * 60 * minute,
                    Date.now() - 60 * minute,
                  ),
                ),
                ...(note.feedback
                  ? {
                      homeworkFeedback: note.feedback,
                      homeworkCheckedAt: new Date(
                        Math.min(
                          lesson.startsAt.getTime() + 44 * 60 * minute,
                          Date.now() - 30 * minute,
                        ),
                      ),
                    }
                  : {}),
              }
            : {}),
        })
        .where(eq(lessons.id, lesson.id));
    }
    const [cycle] = await db
      .select()
      .from(billingCycles)
      .where(eq(billingCycles.id, cycleId));
    await db
      .update(invoices)
      .set({
        status: 'PAID',
        // Issued the day before the cycle, as the rollover job would have.
        issuedAt: DateTime.fromISO(cycle.startDate, {
          zone: 'America/New_York',
        })
          .minus({ days: 1 })
          .set({ hour: 9 })
          .toJSDate(),
        paidAt: DateTime.fromISO(cycle.startDate, { zone: 'America/New_York' })
          .plus({ hours: 10 })
          .toJSDate(),
      })
      .where(eq(invoices.id, invoiceId));
    await db.transaction((tx) =>
      cycles.createCycle(tx, subscriptionId, 2, actor),
    );
    await attendedSoFar(subscriptionId, cycleId);
  }

  // The demo addresses are not real: drop the invoice emails the demo made.
  await db.delete(emailOutbox);

  console.log(
    `Demo data ready. Sign in with any of these and the password ${DEMO_PASSWORD}:`,
  );
  console.log('  admin@academy.local, staff@academy.local');
  console.log(
    '  ahmed@academy.local, mona@academy.local, khaled@academy.local',
  );
  console.log(
    '  omar@academy.local, aisha@academy.local, mariam@academy.local, youssef@academy.local',
  );
  await app.close();
}

await main();
