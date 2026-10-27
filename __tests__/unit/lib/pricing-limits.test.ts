import { LIMIT_KEYS } from '@studiq/server/services/limit.catalog';
import { describe, expect, it } from 'vitest';
import { getVisibleLimitKeys, SORTED_LIMIT_KEYS } from '@/lib/pricing-limits';

const plans = [
  { limits: { max_flashcards: 100, max_students: -1, max_groups: -1 } },
  { limits: { max_flashcards: -1 } },
];

describe('SORTED_LIMIT_KEYS', () => {
  it('lists exactly the catalog keys, so the UI and resolver cannot drift (#233)', () => {
    expect([...SORTED_LIMIT_KEYS].sort()).toEqual([...LIMIT_KEYS].sort());
  });
});

describe('getVisibleLimitKeys', () => {
  it('hides educator/org-only limits for the student comparison', () => {
    expect(getVisibleLimitKeys(plans, 'student')).toEqual(['max_flashcards']);
  });

  it('keeps seat and group limits for educator and manager views', () => {
    for (const type of ['educator', 'manager']) {
      expect(getVisibleLimitKeys(plans, type)).toEqual([
        'max_flashcards',
        'max_students',
        'max_groups',
      ]);
    }
  });

  it('returns nothing without plans', () => {
    expect(getVisibleLimitKeys(undefined, 'student')).toEqual([]);
  });
});
