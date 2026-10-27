import { describe, expect, it } from 'vitest';
import { formatDate } from '@/lib/datetime';

// Local noon so the assertions cannot shift a day with the machine's time zone.
const LOCAL_NOON = new Date(2026, 9, 22, 12, 0, 0);

describe('formatDate (#251)', () => {
  it('formats a Date in the requested app locale, not the runtime default', () => {
    expect(formatDate(LOCAL_NOON, 'pl')).toBe('22.10.2026');
    expect(formatDate(LOCAL_NOON, 'en')).toBe('10/22/2026');
  });

  it('accepts an ISO timestamp string', () => {
    // No `Z`: parsed as local time, so the calendar day is stable everywhere.
    expect(formatDate('2026-10-22T12:00:00', 'pl')).toBe('22.10.2026');
    expect(formatDate('2026-10-22T12:00:00', 'en')).toBe('10/22/2026');
  });
});
