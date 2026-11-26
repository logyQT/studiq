import type { SeatPool } from '@/components/manage/seat-pools-table';

/**
 * Preview data only — never a seed, never a fetch.
 *
 * Two pools is the whole point of the table: one comfortable, one near its
 * ceiling, so the "low" flag is visible on the surface rather than described in
 * the copy. The numbers are demo values, not a customer's. The plan names are
 * the short names `/pricing` prints, so four columns fit a phone gutter.
 */
export const SEAT_POOL_FIXTURES: readonly SeatPool[] = [
  { id: 'plus', planLabel: 'Plus', total: 40, assigned: 12 },
  { id: 'pro', planLabel: 'Max', total: 120, assigned: 113 },
];
