import { purchasableSeatPlans } from '@/lib/seats';
import { describe, expect, it } from 'vitest';

// Phase 4b: the seats page reads the picker list from the plan catalogue query
// instead of local plan maps (R37/D33).

interface PlanLike {
  key: string;
  name: string;
  isActive: boolean;
  scope: string;
  audience: string | null;
  seatEligible: boolean;
}

const CATALOG: PlanLike[] = [
  {
    key: 'base',
    name: 'StudiQ Free',
    isActive: true,
    scope: 'personal',
    audience: null,
    seatEligible: true,
  },
  {
    key: 'launch',
    name: 'StudiQ Launch',
    isActive: true,
    scope: 'organization',
    audience: null,
    seatEligible: true,
  },
  {
    key: 'spark',
    name: 'StudiQ Plus',
    isActive: true,
    scope: 'personal',
    audience: null,
    seatEligible: true,
  },
  {
    key: 'ace',
    name: 'StudiQ Pro',
    isActive: true,
    scope: 'personal',
    audience: null,
    seatEligible: true,
  },
  {
    key: 'pro',
    name: 'StudiQ Max',
    isActive: true,
    scope: 'personal',
    audience: null,
    seatEligible: true,
  },
  {
    key: 'campus',
    name: 'StudiQ Campus',
    isActive: true,
    scope: 'organization',
    audience: null,
    seatEligible: true,
  },
  {
    key: 'retired',
    name: 'StudiQ Retired',
    isActive: false,
    scope: 'personal',
    audience: null,
    seatEligible: true,
  },
  {
    key: 'docs-plan',
    name: 'StudiQ Docs',
    isActive: true,
    scope: 'personal',
    audience: null,
    seatEligible: false,
  },
];

describe('purchasableSeatPlans (D33)', () => {
  it('lists the active personal seat-eligible plans in catalogue order', () => {
    expect(purchasableSeatPlans(CATALOG).map((plan) => plan.key)).toEqual([
      'base',
      'spark',
      'ace',
      'pro',
    ]);
  });

  it('excludes organization plans, inactive plans and non-seat-eligible plans', () => {
    const keys = purchasableSeatPlans(CATALOG).map((plan) => plan.key);

    expect(keys).not.toContain('launch');
    expect(keys).not.toContain('campus');
    expect(keys).not.toContain('retired');
    expect(keys).not.toContain('docs-plan');
  });
});
