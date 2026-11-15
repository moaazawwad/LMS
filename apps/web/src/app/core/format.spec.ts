import {
  addDays,
  city,
  isoWeekday,
  localDate,
  minutesToClock,
  money,
  monthGrid,
  nextWeekday,
  shiftMonth,
  shiftText,
  time,
  typeLabel,
  zonedTimeToUtc,
} from './format';
import { clockToMinutes, dollarsToCents, minutesToInput } from './forms';

describe('format helpers', () => {
  it('says how far a lesson moved on the Cairo clock', () => {
    expect(shiftText(-60)).toBe('1 h earlier');
    expect(shiftText(120)).toBe('2 h later');
    expect(shiftText(30)).toBe('30 min later');
  });

  it('shows a lesson in the student zone and in Cairo, across daylight saving', () => {
    // 9:00 AM in New York before and after Nov 1, 2026
    expect(time('2026-10-27T13:00:00Z', 'America/New_York')).toBe('9:00 AM');
    expect(time('2026-11-03T14:00:00Z', 'America/New_York')).toBe('9:00 AM');
    expect(time('2026-10-27T13:00:00Z', 'Africa/Cairo')).toBe('4:00 PM');
    expect(time('2026-11-03T14:00:00Z', 'Africa/Cairo')).toBe('4:00 PM');
  });

  it('gets the local calendar date of an instant', () => {
    expect(localDate('2026-10-21T02:00:00Z', 'America/New_York')).toBe('2026-10-20');
    expect(localDate('2026-10-21T02:00:00Z', 'Australia/Sydney')).toBe('2026-10-21');
  });

  it('adds days to a date', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
  });

  it('turns a wall-clock time in a zone into the right instant, across clock changes', () => {
    expect(zonedTimeToUtc('2026-10-27', '09:00', 'America/New_York').toISOString()).toBe(
      '2026-10-27T13:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-11-03', '09:00', 'America/New_York').toISOString()).toBe(
      '2026-11-03T14:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-10-29', '16:00', 'Africa/Cairo').toISOString()).toBe(
      '2026-10-29T13:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-10-30', '16:00', 'Africa/Cairo').toISOString()).toBe(
      '2026-10-30T14:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-10-28', '21:00', 'Australia/Sydney').toISOString()).toBe(
      '2026-10-28T10:00:00.000Z',
    );
  });

  it('finds weekdays', () => {
    expect(isoWeekday('2026-10-20')).toBe(2); // Tuesday
    expect(nextWeekday('2026-10-20', 2)).toBe('2026-10-20');
    expect(nextWeekday('2026-10-20', 1)).toBe('2026-10-26');
  });

  it('converts clock inputs to minutes, with 00:00 as a midnight end', () => {
    expect(clockToMinutes('14:00')).toBe(840);
    expect(clockToMinutes('00:00', true)).toBe(1440);
    expect(minutesToInput(1440)).toBe('00:00');
    expect(dollarsToCents('15.5')).toBe(1550);
  });

  it('formats small things', () => {
    expect(city('America/New_York')).toBe('New York');
    expect(minutesToClock(840)).toBe('2:00 PM');
    expect(minutesToClock(1440)).toBe('12:00 AM');
    expect(money(9000, 'USD')).toBe('$90.00');
    expect(typeLabel('EXTRA', 'MAKEUP')).toBe('Extra · makeup');
  });

  it('lays out a month view from the Sunday before the 1st, 6 weeks long', () => {
    const days = monthGrid('2026-10'); // Oct 1, 2026 is a Thursday
    expect(days).toHaveLength(42);
    expect(days[0]).toBe('2026-09-27');
    expect(days[4]).toBe('2026-10-01');
    expect(days[41]).toBe('2026-11-07');
    expect(monthGrid('2026-11')[0]).toBe('2026-11-01'); // Nov 1 is a Sunday
  });

  it('moves between months across the year end', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-10', 0)).toBe('2026-10');
  });
});
