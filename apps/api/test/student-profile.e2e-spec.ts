/**
 * The fuller student file (guardian, level, how they found the academy...)
 * and the staff's notes about a student. WIPES the database at TEST_DATABASE_URL.
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

suite('student file and notes (e2e)', () => {
  let t: TestApp;
  let school: School;
  let staffToken: string;
  let studentToken: string;
  let teacherToken: string;
  let id: string;

  beforeAll(async () => {
    t = await startApp();
    school = await setUpSchool(t, 2, 'file');
    id = school.students[0].id;
    studentToken = await t.login(school.students[0].email);
    teacherToken = await t.login(school.teacher.email);
    await t.http
      .post('/api/staff')
      .set(auth(t.adminToken))
      .send({
        email: 'staff.file@test.local',
        fullName: 'Staff File',
        password: PASSWORD,
        role: 'STAFF',
      })
      .expect(201);
    staffToken = await t.login('staff.file@test.local');
  });

  afterAll(async () => {
    await t.app.close();
  });

  const get = async (token = t.adminToken) =>
    (await t.http.get(`/api/students/${id}`).set(auth(token)).expect(200)).body;

  it('keeps the extra details given when a student is added', async () => {
    const made = (
      await t.http
        .post('/api/students')
        .set(auth(t.adminToken))
        .send({
          email: 'child.file@test.local',
          fullName: 'Adam Child',
          password: PASSWORD,
          timezone: 'America/Toronto',
          country: 'CA',
          gender: 'MALE',
          birthDate: '2016-03-09',
          guardianName: 'Sara Child',
          guardianRelation: 'Mother',
          guardianPhone: '+1 416 555 0100',
          source: 'Website',
        })
        .expect(201)
    ).body;
    const child = (
      await t.http
        .get(`/api/students/${made.id}`)
        .set(auth(t.adminToken))
        .expect(200)
    ).body;
    expect(child).toMatchObject({
      gender: 'MALE',
      birthDate: '2016-03-09',
      guardianName: 'Sara Child',
      guardianRelation: 'Mother',
      guardianPhone: '+1 416 555 0100',
      source: 'Website',
      level: null,
    });
  });

  it('updates and clears the details, and checks them', async () => {
    const patch = (body: object, token = staffToken) =>
      t.http.patch(`/api/students/${id}`).set(auth(token)).send(body);
    await patch({
      whatsapp: ' +1 212 555 0199 ',
      level: 'Reads short surahs',
      goals: 'Finish Juz Amma',
      nativeLanguage: 'English',
      city: 'New York',
      joinedOn: '2026-09-01',
    }).expect(200);
    expect(await get()).toMatchObject({
      whatsapp: '+1 212 555 0199',
      level: 'Reads short surahs',
      goals: 'Finish Juz Amma',
      nativeLanguage: 'English',
      city: 'New York',
      joinedOn: '2026-09-01',
    });
    // An empty text clears a field; the others stay.
    await patch({ goals: '' }).expect(200);
    expect(await get()).toMatchObject({
      goals: null,
      level: 'Reads short surahs',
    });
    await patch({ gender: 'OTHER' }).expect(400);
    await patch({ birthDate: 'last year' }).expect(400);
    await patch({ guardianEmail: 'not-an-email' }).expect(400);
    // A student cannot edit their own file this way.
    await patch({ level: 'Advanced' }, studentToken).expect(403);
    // The name and phone still update as before.
    await patch({ phone: '+1 212 555 0000' }).expect(200);
    expect((await get()).phone).toBe('+1 212 555 0000');
  });

  it('keeps staff notes away from students and teachers', async () => {
    const notes = (token: string) =>
      t.http.get(`/api/students/${id}/notes`).set(auth(token));
    const add = (body: string, token: string) =>
      t.http.post(`/api/students/${id}/notes`).set(auth(token)).send({ body });
    const first = (await add('Prefers mornings.', staffToken).expect(201)).body;
    await add('Father pays by InstaPay.', t.adminToken).expect(201);
    await add('   ', staffToken).expect(400);

    const list = (await notes(t.adminToken).expect(200)).body;
    expect(list.map((n: { body: string }) => n.body)).toEqual([
      'Father pays by InstaPay.',
      'Prefers mornings.',
    ]);
    expect(list[1]).toMatchObject({ authorName: 'Staff File' });

    await notes(studentToken).expect(403);
    await notes(teacherToken).expect(403);
    await add('I am great', studentToken).expect(403);
    // The student's own file has no notes in it.
    expect(JSON.stringify(await get(studentToken))).not.toContain('mornings');

    // Only the writer or an admin removes a note.
    const adminNote = list[0].id as string;
    await t.http
      .delete(`/api/students/${id}/notes/${adminNote}`)
      .set(auth(staffToken))
      .expect(403);
    await t.http
      .delete(`/api/students/${id}/notes/${first.id}`)
      .set(auth(staffToken))
      .expect(204);
    await t.http
      .delete(`/api/students/${id}/notes/${adminNote}`)
      .set(auth(t.adminToken))
      .expect(204);
    expect((await notes(t.adminToken).expect(200)).body).toEqual([]);
    // A note of another student is not found under this one.
    await t.http
      .delete(`/api/students/${school.students[1].id}/notes/${first.id}`)
      .set(auth(t.adminToken))
      .expect(404);
  });
});
