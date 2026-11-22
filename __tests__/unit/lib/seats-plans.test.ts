import { poolsForPersona, purchasableSeatPlans } from '@/lib/seats';
import { describe, expect, it } from 'vitest';

// Phase 4b: the seats page reads both picker lists from the plan catalogue
// query instead of local plan maps (R37/D33).

interface PlanLike {
  key: string;
  name: string;
  isActive: boolean;
  scope: string;
  audience: string | null;
  seatEligible: boolean;
}

const CATALOG: PlanLike[] = [
  { key: 'base', name: 'StudiQ Base', isActive: true, scope: 'personal', audience: 'student', seatEligible: true },
  { key: 'launch', name: 'StudiQ Launch', isActive: true, scope: 'organization', audience: null, seatEligible: true },
  { key: 'ace', name: 'StudiQ Ace', isActive: true, scope: 'personal', audience: 'student', seatEligible: true },
  { key: 'creator', name: 'StudiQ Creator', isActive: true, scope: 'personal', audience: 'educator', seatEligible: true },
  { key: 'solo', name: 'StudiQ Solo', isActive: true, scope: 'personal', audience: 'manager', seatEligible: true },
  { key: 'pro', name: 'StudiQ Pro', isActive: true, scope: 'personal', audience: 'student', seatEligible: true },
  { key: 'campus', name: 'StudiQ Campus', isActive: true, scope: 'organization', audience: null, seatEligible: true },
  { key: 'retired', name: 'StudiQ Retired', isActive: false, scope: 'personal', audience: 'student', seatEligible: true },
  { key: 'docs-plan', name: 'StudiQ Docs', isActive: true, scope: 'personal', audience: 'student', seatEligible: false },
];

const POOLS = [
  { id: 'pool-ace', planKey: 'ace', total: 3, assigned: 0 },
  { id: 'pool-pro', planKey: 'pro', total: 2, assigned: 0 },
  { id: 'pool-creator', planKey: 'creator', total: 3, assigned: 0 },
  { id: 'pool-solo', planKey: 'solo', total: 1, assigned: 0 },
  { id: 'pool-ghost', planKey: 'not-in-catalog', total: 1, assigned: 0 },
];

describe('purchasableSeatPlans (D33)', () => {
  it('lists the active personal seat-eligible plans in catalogue order', () => {
    expect(purchasableSeatPlans(CATALOG).map((plan) => plan.key)).toEqual([
      'base',
      'ace',
      'creator',
      'solo',
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

describe('poolsForPersona (D14/D33)', () => {
  it('offers a student exactly the student-audience pools', () => {
    expect(poolsForPersona(POOLS, CATALOG, 'student').map((pool) => pool.planKey)).toEqual([
      'ace',
      'pro',
    ]);
  });

  it('offers an educator only the educator pool and a manager only the manager pool', () => {
    expect(poolsForPersona(POOLS, CATALOG, 'educator').map((pool) => pool.planKey)).toEqual([
      'creator',
    ]);
    expect(poolsForPersona(POOLS, CATALOG, 'manager').map((pool) => pool.planKey)).toEqual([
      'solo',
    ]);
  });

  it('fails closed for a pool whose plan is missing from the catalogue', () => {
    expect(poolsForPersona(POOLS, CATALOG, 'student').map((pool) => pool.id)).not.toContain(
      'pool-ghost',
    );
    expect(poolsForPersona(POOLS, [], 'student')).toEqual([]);
  });
});
