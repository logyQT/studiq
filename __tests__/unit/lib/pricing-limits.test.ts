import { LIMIT_KEYS } from '@studiq/authz';
import { describe, expect, it } from 'vitest';
import { getVisibleLimitKeys, SORTED_LIMIT_KEYS } from '@/lib/pricing-limits';

const plans = [
  { limits: { max_flashcards: 100, max_students: -1, max_groups: -1 } },
  { limits: { max_flashcards: -1 } },
];

describe('SORTED_LIMIT_KEYS', () => {
  it('lists exactly the catalog keys, so the UI and resolver cannot drift (#233)', () => {
    expect([...SORTED_LIMIT_KEYS].toSorted()).toEqual([...LIMIT_KEYS].toSorted());
  });
});

describe('getVisibleLimitKeys', () => {
  it('hides organization-only limits for a personal comparison', () => {
    expect(getVisibleLimitKeys(plans, 'personal')).toEqual(['max_flashcards']);
  });

  it('keeps seat and group limits on the organization ladder', () => {
    expect(getVisibleLimitKeys(plans, 'organization')).toEqual([
      'max_flashcards',
      'max_students',
      'max_groups',
    ]);
  });

  it('returns nothing without plans', () => {
    expect(getVisibleLimitKeys(undefined, 'personal')).toEqual([]);
  });
});
