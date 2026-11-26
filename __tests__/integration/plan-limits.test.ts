import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type BeforeResult, before } from '#test/helpers/test-user';
import {
  useRealSupabase,
  cleanupOrganizationDeep,
  createServiceClient,
} from '#test/integration/helpers';

// Regression tests for the plan-limit config fixes in the plan-catalogue
// migration (the catalogue's single home since #1494; it was
// `supabase/seeds/00_plans.sql` before that).
//
// O1/D2: new orgs got max_groups = 1 (launch plan default) → org owners could not
//        create a second group (429 USAGE_LIMIT_EXCEEDED). Raised to 3.
// D1 hardening: a personal plan never carries max_students/max_groups. Since
//        #1193 the one individual ladder has no org-scope rows at all, so the
//        'free' plan cannot widen anything even before #233's read rule.
//        (Primary D1 fix is checkOrgLimit + invite-accept.test.ts.)
describe(`Plan limit fixes`, () => {
  let fixture!: BeforeResult;

  beforeAll(async () => {
    fixture = await before({
      role: 'manager',
      org: true,
      groups: 2,
      members: { count: 1 },
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useRealSupabase();
  });

  afterAll(async () => {
    if (fixture.orgId) {
      await cleanupOrganizationDeep(fixture.orgId);
    }
  });

  it('O1/D2 — org owner can create 2 extra groups via API (launch max_groups = 3 total)', () => {
    // default group + 2 extra groups, all created through the real API
    expect(fixture.groups.length).toBe(3);
    expect(fixture.defaultGroupId).toBe(fixture.groups[0]);
  });

  it('D1 hardening — the Free plan carries no org-management rows', async () => {
    const supabase = createServiceClient();
    for (const key of ['max_students', 'max_groups']) {
      const { data: limit } = await supabase
        .from('plan_limits')
        .select('limit_value')
        .eq('plan_key', 'free')
        .eq('limit_key', key)
        .maybeSingle();
      expect(limit, `base must not carry ${key}`).toBeNull();
    }
  });
});
