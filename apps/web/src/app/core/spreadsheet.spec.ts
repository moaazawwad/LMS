import { mapHeaders, parseCsv, parseXlsx, toRecords } from './spreadsheet';

describe('reading spreadsheets', () => {
  it('reads CSV with quotes, commas inside cells and Windows line ends', () => {
    const csv =
      '﻿Name,Email,Notes\r\n"Ali, Jr.",ali@example.com,"said ""hi"""\r\nSara,sara@example.com,\r\n';
    expect(parseCsv(csv)).toEqual([
      ['Name', 'Email', 'Notes'],
      ['Ali, Jr.', 'ali@example.com', 'said "hi"'],
      ['Sara', 'sara@example.com', ''],
    ]);
  });

  it('reads CSV saved with semicolons', () => {
    expect(parseCsv('Name;Email\nAli;ali@example.com')).toEqual([
      ['Name', 'Email'],
      ['Ali', 'ali@example.com'],
    ]);
  });

  it('understands column names in English and Arabic, ignoring the rest', () => {
    expect(mapHeaders(['Full Name', 'E-mail', 'Time zone', 'Notes', 'Phone Number'])).toEqual([
      'fullName',
      'email',
      'timezone',
      null,
      'phone',
    ]);
    expect(mapHeaders(['الاسم', 'الإيميل', 'المستوى', 'المناهج', 'سعر الساعة'])).toEqual([
      'fullName',
      'email',
      'level',
      'curricula',
      'hourlyRate',
    ]);
    // A second column with the same meaning is ignored.
    expect(mapHeaders(['Name', 'Student name'])).toEqual(['fullName', null]);
  });

  it('turns rows into records and skips empty ones', () => {
    const { records, sheetRows } = toRecords([
      ['Name', 'Email', 'City'],
      ['Ali', ' ali@example.com ', 'Toronto'],
      ['', '', ''],
      ['Sara', 'sara@example.com', ''],
    ]);
    expect(sheetRows).toEqual([2, 4]);
    expect(records).toEqual([
      { fullName: 'Ali', email: 'ali@example.com', timezone: 'Toronto' },
      { fullName: 'Sara', email: 'sara@example.com' },
    ]);
  });

  it('reads the first sheet of an Excel file', () => {
    // A tiny workbook: sheet "People" at worksheets/people.xml, shared and inline strings, a gap row.
    const xlsx =
      'UEsDBBQAAAAIAGKAWl0hRWeOkwAAAOQAAAAPAAAAeGwvd29ya2Jvb2sueG1sjY9NDoIwEIWv0swBHNTEBQFWbth5hQqDbWg7zUyNHl8Csmc1Py/ve3nNh2V+Ms/mG0PSFlwpuUbUwVG0euJMaVEmlmjLcsoLNQvZUR1RiQEvVXXDaH2CjVDLEQZPkx/ozsM7UiobRCjY4jmp81mha9YE/U+TbKQWHsQ5EJj1148tnMFI7ZdF+vEK2DW423Bv1v0AUEsDBBQAAAAIAGKAWl2viiDndAAAAJwAAAAaAAAAeGwvX3JlbHMvd29ya2Jvb2sueG1sLnJlbHNVzksKwzAMRdGtBC8gCi10UGLPMy3dgEhUO8QfIQna5dfDZPh4cLjzizLa3qqmnXX4lVzVu2TGTwBdExXUsTHV/nyaFLQ+JQLjemAkuE3TA+RsuHAxh2XzTpbt7oY3SiTz7tvk0ERkCkyNM40ddxBmuMSEP1BLAwQUAAAACABigFpdCpH3i3QAAACjAAAAFAAAAHhsL3NoYXJlZFN0cmluZ3MueG1sXc4xDoMwDIXhqyAOUKMOHSrXc6cO7Qms4jZIOIliD3B7AkgMjP9nDw/NvJl0jPZog3u+A9g3iLJdUpZYL79UlL1m+YPlItxbEHEd4dp1N1AeYktoA6HTi1UQnBDW3u3NfrKy8jP13Oxee6MP63zI9g11HS1QSwMEFAAAAAgAYoBaXXHELj2tAAAAPwEAABgAAAB4bC93b3Jrc2hlZXRzL3Blb3BsZS54bWxdkEsOwjAMRK9S5QC4P1igNBKCPQtOEJVAI5qkcqyW4+NWKC3sPDP2s2w5BXzFzhjK3q73sREd0XAEiG1nnI67MBjPySOg08QSnxAHNPq+DLkeyjw/gNPWCyUX76JJK4lhyrARBbvtXJwKkVEjIutR5RJGJaH9ZudtVqQMmJFAVQJVm+byDzR3sbtfF/xA6gSpF4j1vfXmRsi+jUqSujqNEojnZr0CYHMapJ+pD1BLAQIUABQAAAAIAGKAWl0hRWeOkwAAAOQAAAAPAAAAAAAAAAAAAAAAAAAAAAB4bC93b3JrYm9vay54bWxQSwECFAAUAAAACABigFpdr4og53QAAACcAAAAGgAAAAAAAAAAAAAAAADAAAAAeGwvX3JlbHMvd29ya2Jvb2sueG1sLnJlbHNQSwECFAAUAAAACABigFpdCpH3i3QAAACjAAAAFAAAAAAAAAAAAAAAAABsAQAAeGwvc2hhcmVkU3RyaW5ncy54bWxQSwECFAAUAAAACABigFpdccQuPa0AAAA/AQAAGAAAAAAAAAAAAAAAAAASAgAAeGwvd29ya3NoZWV0cy9wZW9wbGUueG1sUEsFBgAAAAAEAAQADQEAAPUCAAAAAA==';
    const bytes = Uint8Array.from(atob(xlsx), (c) => c.charCodeAt(0));
    expect(parseXlsx(bytes)).toEqual([
      ['Name', '', 'Rate'],
      [],
      ['Hoda Samy', '', '250'],
      ['Omar'],
    ]);
  });
});
