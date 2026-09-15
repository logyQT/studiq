import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';
import { type BeforeResult, before } from '#test/helpers/test-user';
import {
  applyRegisteredMock,
  cleanupOrganizationDeep,
  createServiceClient,
} from '#test/integration/helpers';

// Regression tests for the plan-limit config fixes in supabase/seeds/00_plans.sql
//
// O1/D2: new orgs got max_groups = 1 (launch plan default) → org owners could not
//        create a second group (429 USAGE_LIMIT_EXCEEDED). Raised to 3.
// D1 hardening: 'base' (default student plan) now carries max_students/max_groups
//        = -1 so personal-plan paths never resolve org-management limits to 0.
//        (Primary D1 fix is LimitsResolver.checkOrgLimit + invite-accept.test.ts.)
forEachCopy((copyId) => {
  describe(`Plan limit fixes [${copyId}]`, () => {
    registerMock(copyId, null);

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
      applyRegisteredMock(copyId);
    });

    afterAll(async () => {
      if (fixture?.orgId) {
        await cleanupOrganizationDeep(fixture.orgId);
      }
    });

    it('O1/D2 — org owner can create 2 extra groups via API (launch max_groups = 3 total)', async () => {
      // default group + 2 extra groups, all created through the real API
      expect(fixture.groups.length).toBe(3);
      expect(fixture.defaultGroupId).toBe(fixture.groups[0]);
    });

    it('D1 hardening — base plan resolves org-management limits to -1 (unlimited)', async () => {
      const supabase = createServiceClient();
      for (const key of ['max_students', 'max_groups']) {
        const { data: limit } = await supabase
          .from('plan_limits')
          .select('limit_value')
          .eq('plan_key', 'base')
          .eq('limit_key', key)
          .maybeSingle();
        expect(limit?.limit_value).toBe(-1);
      }
    });
  });
});
