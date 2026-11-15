import { violationText } from './api.service';

describe('violationText', () => {
  it('says a repeated reason once, with the lesson times', () => {
    const reason = 'The teacher is not available at that time.';
    const at = [
      'Fri, Oct 23 · 3:00 AM Cairo',
      'Wed, Oct 28 · 3:00 AM Cairo',
      'Fri, Oct 30 · 2:00 AM Cairo',
      'Wed, Nov 4 · 2:00 AM Cairo',
    ];
    const text = violationText([
      ...at.map((a) => ({ code: 'OUTSIDE_AVAILABILITY', at: a, message: `${a}: ${reason}` })),
      { code: 'LOWER_LEVEL_TEACHER', message: 'This teacher is below the premium level.' },
    ]);
    expect(text).toBe(
      'The teacher is not available at that time (4 lessons: Fri, Oct 23 · 3:00 AM Cairo; Wed, Oct 28 · 3:00 AM Cairo; Fri, Oct 30 · 2:00 AM Cairo; and 1 more). This teacher is below the premium level.',
    );
  });

  it('keeps plain messages as they are', () => {
    expect(violationText([{ code: 'QUOTA', message: 'No cancels left this cycle.' }])).toBe(
      'No cancels left this cycle.',
    );
  });
});
