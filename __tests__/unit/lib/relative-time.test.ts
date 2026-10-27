import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from '@/lib/relative-time';

// #654: the teacher dashboard feed says when something happened, in the app locale.

const NOW = new Date('2026-10-27T12:00:00Z').getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatRelativeTime', () => {
  it('reads "now" for anything under a minute', () => {
    expect(formatRelativeTime(ago(20 * 1000), 'en', NOW)).toBe('now');
    expect(formatRelativeTime(ago(20 * 1000), 'pl', NOW)).toBe('teraz');
  });

  it('counts minutes, hours and days back in English', () => {
    expect(formatRelativeTime(ago(5 * MIN), 'en', NOW)).toBe('5 minutes ago');
    expect(formatRelativeTime(ago(3 * HOUR), 'en', NOW)).toBe('3 hours ago');
    expect(formatRelativeTime(ago(2 * DAY), 'en', NOW)).toBe('2 days ago');
  });

  it('uses Polish plural forms', () => {
    expect(formatRelativeTime(ago(5 * MIN), 'pl', NOW)).toBe('5 minut temu');
    expect(formatRelativeTime(ago(2 * MIN), 'pl', NOW)).toBe('2 minuty temu');
    expect(formatRelativeTime(ago(5 * DAY), 'pl', NOW)).toBe('5 dni temu');
  });

  it('uses the Polish words for yesterday and the day before', () => {
    expect(formatRelativeTime(ago(DAY), 'pl', NOW)).toBe('wczoraj');
    expect(formatRelativeTime(ago(2 * DAY), 'pl', NOW)).toBe('przedwczoraj');
  });

  it('says "yesterday" for exactly one day', () => {
    expect(formatRelativeTime(ago(DAY), 'en', NOW)).toBe('yesterday');
  });

  it('switches to months and years for old events', () => {
    expect(formatRelativeTime(ago(45 * DAY), 'en', NOW)).toMatch(/month/);
    expect(formatRelativeTime(ago(800 * DAY), 'en', NOW)).toMatch(/year/);
  });

  it('accepts a Date as well as an ISO string', () => {
    expect(formatRelativeTime(new Date(NOW - 2 * HOUR), 'en', NOW)).toBe('2 hours ago');
  });
});
