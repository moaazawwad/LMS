/**
 * Curriculum books (PDF): staff upload, the curriculum's people open them.
 * WIPES the database at TEST_DATABASE_URL.
 */
import {
  auth,
  PASSWORD,
  type School,
  setUpSchool,
  startApp,
  type TestApp,
  testDbUrl,
} from './helpers.js';

const suite = testDbUrl ? describe : describe.skip;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

suite('curriculum books (e2e)', () => {
  let t: TestApp;
  let school: School;
  let bookId: string;

  beforeAll(async () => {
    t = await startApp();
    school = await setUpSchool(t, 1, 'book');
  });

  afterAll(async () => {
    await t?.app.close();
  });

  const upload = (
    token: string,
    file = PDF,
    name = 'student-book.pdf',
    type = 'application/pdf',
  ) =>
    t.http
      .post(`/api/curricula/${school.curriculumId}/files`)
      .set(auth(token))
      .field('title', 'Student book')
      .attach('file', file, { filename: name, contentType: type });

  it('staff upload a PDF; other files are refused', async () => {
    const res = await upload(t.adminToken).expect(201);
    expect(res.body).toMatchObject({
      title: 'Student book',
      fileName: 'student-book.pdf',
    });
    expect(res.body).not.toHaveProperty('data');
    bookId = res.body.id;
    await upload(
      t.adminToken,
      Buffer.from('hello'),
      'notes.txt',
      'text/plain',
    ).expect(400);
    // Says it is a PDF but is not one.
    await upload(t.adminToken, Buffer.from('not a pdf'), 'fake.pdf').expect(
      400,
    );
    const teacherToken = await t.login(school.teacher.email);
    await upload(teacherToken).expect(403);
  });

  it("the curriculum's teacher and student open it; others do not", async () => {
    for (const email of [school.teacher.email, school.students[0].email]) {
      const token = await t.login(email);
      const mine = (
        await t.http.get('/api/my-books').set(auth(token)).expect(200)
      ).body;
      expect(mine).toHaveLength(1);
      expect(mine[0].files.map((f: { id: string }) => f.id)).toEqual([bookId]);
      const file = await t.http
        .get(`/api/curricula/${school.curriculumId}/files/${bookId}`)
        .set(auth(token))
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(file.headers['content-type']).toBe('application/pdf');
      expect(file.headers['content-disposition']).toMatch(/^inline/);
      expect((file.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    }
    // A student of another curriculum sees nothing.
    await t.http
      .post('/api/students')
      .set(auth(t.adminToken))
      .send({
        email: 'other.book@test.local',
        fullName: 'Other',
        password: PASSWORD,
        timezone: 'UTC',
      })
      .expect(201);
    const other = await t.login('other.book@test.local');
    expect(
      (await t.http.get('/api/my-books').set(auth(other)).expect(200)).body,
    ).toEqual([]);
    await t.http
      .get(`/api/curricula/${school.curriculumId}/files/${bookId}`)
      .set(auth(other))
      .expect(404);
  });

  it('staff remove it, and the log says so', async () => {
    await t.http
      .delete(`/api/curricula/${school.curriculumId}/files/${bookId}`)
      .set(auth(t.adminToken))
      .expect(200);
    expect(
      (
        await t.http
          .get(`/api/curricula/${school.curriculumId}/files`)
          .set(auth(t.adminToken))
          .expect(200)
      ).body,
    ).toEqual([]);
    const log = (
      await t.http
        .get(`/api/audit-logs?action=curriculum.file`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(log.map((e: { summary: string }) => e.summary)).toEqual([
      'Removed the book "Student book" from Foundations book',
      'Added the book "Student book" (0.0 MB) to Foundations book',
    ]);
  });
});
