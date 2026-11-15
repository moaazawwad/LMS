import { needsNotes } from './history';

describe('needsNotes', () => {
  it('flags held lessons without notes', () => {
    expect(needsNotes({ status: 'COMPLETED', notes: null, attendance: 'BOTH' })).toBe(true);
    expect(needsNotes({ status: 'COMPLETED', notes: '   ', attendance: null })).toBe(true);
    expect(needsNotes({ status: 'COMPLETED', notes: 'Unit 3', attendance: 'BOTH' })).toBe(false);
  });

  it('skips lessons the student missed, or nobody came to', () => {
    expect(needsNotes({ status: 'COMPLETED', notes: null, attendance: 'TEACHER_ONLY' })).toBe(
      false,
    );
    expect(needsNotes({ status: 'COMPLETED', notes: null, attendance: 'NONE' })).toBe(false);
  });

  it('waits for the academy when the teacher did not enter', () => {
    expect(needsNotes({ status: 'SCHEDULED', notes: null, attendance: 'STUDENT_ONLY' })).toBe(
      false,
    );
    expect(needsNotes({ status: 'SCHEDULED', notes: null, attendance: 'NONE' })).toBe(false);
  });

  it('skips cancelled, moved and upcoming lessons', () => {
    expect(needsNotes({ status: 'CANCELLED', notes: null, attendance: null })).toBe(false);
    expect(needsNotes({ status: 'RESCHEDULED', notes: null, attendance: null })).toBe(false);
    expect(needsNotes({ status: 'SCHEDULED', notes: null, attendance: null })).toBe(false);
  });
});
