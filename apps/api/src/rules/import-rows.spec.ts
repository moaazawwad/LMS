import {
  checkStudentRows,
  checkTeacherRows,
  readablePassword,
  resolveTimeZone,
} from './import-rows.js';

describe('reading people from a spreadsheet', () => {
  it('understands time zones as names or cities', () => {
    expect(resolveTimeZone('America/New_York')).toBe('America/New_York');
    expect(resolveTimeZone('america/new_york')).toBe('America/New_York');
    expect(resolveTimeZone(' new york ')).toBe('America/New_York');
    expect(resolveTimeZone('Sydney')).toBe('Australia/Sydney');
    expect(resolveTimeZone('Los-Angeles')).toBe('America/Los_Angeles');
    expect(resolveTimeZone('Narnia')).toBeNull();
    expect(resolveTimeZone('')).toBeNull();
  });

  it('checks each student row and says what is wrong', () => {
    const [ok, bad, repeat] = checkStudentRows([
      {
        fullName: '  Sara   Ali ',
        email: 'Sara@Example.com',
        timezone: 'Toronto',
        phone: ' +1 555 ',
      },
      {
        fullName: 'B',
        email: 'not-an-email',
        timezone: 'Mars',
        password: 'short',
      },
      {
        fullName: 'Sara Again',
        email: 'sara@example.com',
        timezone: 'Toronto',
      },
    ]);
    expect(ok).toMatchObject({
      row: 1,
      problems: [],
      value: {
        fullName: 'Sara Ali',
        email: 'sara@example.com',
        timezone: 'America/Toronto',
        phone: '+1 555',
        password: null,
      },
    });
    expect(bad.value).toBeNull();
    expect(bad.problems).toEqual([
      'Name is missing.',
      '"not-an-email" is not an email address.',
      'Password is shorter than 8 characters (leave it empty to get one made).',
      'Unknown time zone "Mars". Use a name like America/New_York, or a big city like Toronto.',
    ]);
    expect(repeat.problems).toEqual(['Same email as row 1.']);
    expect(repeat.value).toBeNull();
  });

  it('needs a time zone for students', () => {
    expect(
      checkStudentRows([{ fullName: 'No Zone', email: 'nz@example.com' }])[0]
        .problems[0],
    ).toContain('Time zone is missing');
  });

  it('checks teacher rows against the curricula the academy has', () => {
    const known = ['Foundations 1', 'Reading 1'];
    const [ok, bad] = checkTeacherRows(
      [
        {
          fullName: 'Hoda Samy',
          email: 'hoda@example.com',
          level: 'premium',
          curricula: 'foundations 1; Reading 1;',
          hourlyRate: 'EGP 250.5',
          zoomLink: 'https://zoom.us/j/1',
        },
        {
          fullName: 'Ali',
          email: 'ali@example.com',
          level: 'expert',
          curricula: 'Tajweed',
          hourlyRate: 'two hundred',
          zoomLink: 'zoom.us/j/2',
        },
      ],
      known,
    );
    expect(ok.value).toEqual({
      fullName: 'Hoda Samy',
      email: 'hoda@example.com',
      phone: null,
      password: null,
      level: 'PREMIUM',
      curriculumNames: ['Foundations 1', 'Reading 1'],
      hourlyRateCents: 25050,
      zoomLink: 'https://zoom.us/j/1',
    });
    expect(bad.problems).toEqual([
      'Level "expert" should be Premium, Standard or Basic.',
      'Not in Curricula & plans: "Tajweed". Add them there first or fix the spelling.',
      'Hourly rate "two hundred" should be a number, like 200.',
      'Class link should start with https://.',
    ]);
  });

  it('a rate can be left empty', () => {
    const [row] = checkTeacherRows(
      [{ fullName: 'No Rate', email: 'nr@example.com', level: 'Basic' }],
      [],
    );
    expect(row.value).toMatchObject({
      hourlyRateCents: null,
      curriculumNames: [],
    });
  });

  it('makes readable passwords', () => {
    const p = readablePassword();
    expect(p).toHaveLength(12);
    expect(p).not.toMatch(/[0O1l]/);
  });
});
