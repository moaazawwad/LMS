/**
 * Homework: the student sends an answer, the teacher replies with feedback.
 * WIPES the database at TEST_DATABASE_URL. Emails stay in memory.
 */
import { MailService } from '../src/mail/mail.service.js';
import {
  auth,
  type School,
  setUpSchool,
  startApp,
  type TestApp,
  testDbUrl,
} from './helpers.js';

const suite = testDbUrl ? describe : describe.skip;

suite('homework (e2e)', () => {
  let t: TestApp;
  let school: School;
  let mail: MailService;
  let studentToken: string;
  let otherToken: string;
  let teacherToken: string;
  let lessonId: string;

  beforeAll(async () => {
    t = await startApp();
    school = await setUpSchool(t, 2, 'hw');
    mail = t.app.get(MailService);
    studentToken = await t.login(school.students[0].email);
    otherToken = await t.login(school.students[1].email);
    teacherToken = await t.login(school.teacher.email);
    [lessonId] = school.students[0].lessonIds;
  });

  afterAll(async () => {
    await t?.app.close();
  });

  it('can only be sent when the lesson has homework, by its own student', async () => {
    await t.http
      .post(`/api/lessons/${lessonId}/homework`)
      .set(auth(studentToken))
      .send({ answer: 'Done' })
      .expect(409);
    await t.http
      .patch(`/api/lessons/${lessonId}/notes`)
      .set(auth(teacherToken))
      .send({
        notes: 'Good reading.',
        homeworkTitle: 'Page 12',
        homeworkBody: 'Read page 12 and write three new words.',
      })
      .expect(200);
    await t.http
      .post(`/api/lessons/${lessonId}/homework`)
      .set(auth(otherToken))
      .send({ answer: 'Mine' })
      .expect(404);
    await t.http
      .post(`/api/lessons/${lessonId}/homework`)
      .set(auth(teacherToken))
      .send({ answer: 'x' })
      .expect(403);
    await t.http
      .post(`/api/lessons/${lessonId}/homework`)
      .set(auth(studentToken))
      .send({ answer: '   ' })
      .expect(400);
    // Feedback needs an answer first.
    await t.http
      .post(`/api/lessons/${lessonId}/homework/feedback`)
      .set(auth(teacherToken))
      .send({ feedback: 'Well done' })
      .expect(409);
  });

  it('the student sends an answer and can change it; the teacher hears about it', async () => {
    await t.http
      .post(`/api/lessons/${lessonId}/homework`)
      .set(auth(studentToken))
      .send({ answer: 'book, pen, door' })
      .expect(200);
    const changed = (
      await t.http
        .post(`/api/lessons/${lessonId}/homework`)
        .set(auth(studentToken))
        .send({ answer: 'book, window, door' })
        .expect(200)
    ).body;
    expect(changed).toMatchObject({
      homeworkAnswer: 'book, window, door',
      homeworkFeedback: null,
      homeworkCheckedAt: null,
    });
    expect(changed.homeworkSentAt).toBeTruthy();

    await mail.flush();
    const sent = mail.sent.filter(
      (m) => m.to === school.teacher.email && m.kind === 'homework-sent',
    );
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent[0].text).toContain('sent the homework "Page 12"');
    expect(sent[0].text).toContain(`/teacher/lessons/${lessonId}`);

    const waiting = (
      await t.http
        .get('/api/lessons/homework-to-check')
        .set(auth(teacherToken))
        .expect(200)
    ).body;
    expect(waiting.map((l: { id: string }) => l.id)).toEqual([lessonId]);
    await t.http
      .get('/api/lessons/homework-to-check')
      .set(auth(studentToken))
      .expect(403);
  });

  it('the student attaches a photo or a recording; the teacher downloads it', async () => {
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d4948445200000001000000010806000000',
      'hex',
    );
    const up = (token: string, name: string, type: string, body = png) =>
      t.http
        .post(`/api/lessons/${lessonId}/homework/files`)
        .set(auth(token))
        .attach('file', body, { filename: name, contentType: type });

    const files = (
      await up(studentToken, 'my page.png', 'image/png').expect(201)
    ).body;
    expect(files).toEqual([
      expect.objectContaining({
        fileName: 'my page.png',
        contentType: 'image/png',
        size: png.length,
      }),
    ]);
    await up(studentToken, 'virus.exe', 'application/x-msdownload').expect(400);
    await up(otherToken, 'x.png', 'image/png').expect(404);
    await up(teacherToken, 'x.png', 'image/png').expect(403);
    await up(studentToken, 'reading.m4a', 'audio/mp4').expect(201);
    await up(studentToken, 'page2.pdf', 'application/pdf').expect(201);
    await up(studentToken, 'one-more.png', 'image/png').expect(409);

    const list = (
      await t.http
        .get(`/api/lessons/${lessonId}/homework/files`)
        .set(auth(teacherToken))
        .expect(200)
    ).body;
    expect(list.map((f: { fileName: string }) => f.fileName)).toEqual([
      'my page.png',
      'reading.m4a',
      'page2.pdf',
    ]);
    const got = await t.http
      .get(`/api/lessons/${lessonId}/homework/files/${list[0].id}`)
      .set(auth(teacherToken))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(got.headers['content-type']).toBe('image/png');
    expect(got.headers['content-disposition']).toContain(
      "filename*=UTF-8''my%20page.png",
    );
    expect(Buffer.compare(got.body as Buffer, png)).toBe(0);
    await t.http
      .get(`/api/lessons/${lessonId}/homework/files/${list[0].id}`)
      .set(auth(otherToken))
      .expect(403);

    await t.http
      .delete(`/api/lessons/${lessonId}/homework/files/${list[2].id}`)
      .set(auth(studentToken))
      .expect(200);
    expect(
      (
        await t.http
          .get(`/api/lessons/${lessonId}/homework/files`)
          .set(auth(studentToken))
          .expect(200)
      ).body,
    ).toHaveLength(2);
  });

  it('the teacher replies; the answer is then fixed and the student is told', async () => {
    const checked = (
      await t.http
        .post(`/api/lessons/${lessonId}/homework/feedback`)
        .set(auth(teacherToken))
        .send({ feedback: 'Great words! Check the spelling of "window".' })
        .expect(200)
    ).body;
    expect(checked.homeworkFeedback).toBe(
      'Great words! Check the spelling of "window".',
    );
    expect(checked.homeworkCheckedAt).toBeTruthy();

    const seen = (
      await t.http
        .get(`/api/lessons/${lessonId}`)
        .set(auth(studentToken))
        .expect(200)
    ).body;
    expect(seen).toMatchObject({
      homeworkAnswer: 'book, window, door',
      homeworkFeedback: 'Great words! Check the spelling of "window".',
    });
    await t.http
      .post(`/api/lessons/${lessonId}/homework`)
      .set(auth(studentToken))
      .send({ answer: 'again' })
      .expect(409);
    await t.http
      .post(`/api/lessons/${lessonId}/homework/files`)
      .set(auth(studentToken))
      .attach('file', Buffer.from('x'), {
        filename: 'late.png',
        contentType: 'image/png',
      })
      .expect(409);
    expect(
      (
        await t.http
          .get('/api/lessons/homework-to-check')
          .set(auth(teacherToken))
          .expect(200)
      ).body,
    ).toHaveLength(0);

    await mail.flush();
    const told = mail.sent.find(
      (m) => m.to === school.students[0].email && m.kind === 'homework-checked',
    )!;
    expect(told.subject).toBe(
      'Your homework was checked · Brightverse Academy',
    );

    const log = (
      await t.http
        .get(`/api/audit-logs?entityId=${lessonId}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(log.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(['homework.send', 'homework.check']),
    );
  });
});
