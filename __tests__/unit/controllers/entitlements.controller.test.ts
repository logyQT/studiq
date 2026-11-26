import {
  AccountType,
  LIMIT_KEYS,
  type RequestContext,
  type ResolvedEntitlements,
} from '@studiq/authz';
import { EntitlementsController } from '@studiq/server/controllers/entitlements.controller';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@studiq/server/lib/entitlements', () => ({
  resolveEntitlements: vi.fn(),
}));

import { resolveEntitlements } from '@studiq/server/lib/entitlements';

const mockCtx: RequestContext = {
  traceId: 'test',
  userId: 'u-1',
  accountType: AccountType.STUDENT,
  orgRoleId: null,
  activeOrgId: null,
  url: '',
  method: 'GET',
  groupIds: [],
  permissionScopes: {},
};

function dataOf<T>(response: ControllerResponse<T>): T | undefined {
  return response.success ? response.data : undefined;
}

const RESOLVED: ResolvedEntitlements = {
  entitlements: ['flashcards', 'quiz'],
  limits: Object.fromEntries(LIMIT_KEYS.map((key) => [key, -1])),
  sources: {
    org: null,
    seat: null,
    personal: null,
    overrides: [],
    revokedOverrides: [],
    flagsOff: [],
  },
  plan: {
    primary: 'free',
    sources: [{ planKey: 'free', origin: 'personal' }],
  },
};

describe('EntitlementsController', () => {
  let controller: EntitlementsController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new EntitlementsController();
    vi.mocked(resolveEntitlements).mockResolvedValue(RESOLVED);
  });

  describe('myEntitlements', () => {
    it('publishes the effective set, limits and plan from the single resolver', async () => {
      const response = await controller.myEntitlements(mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect(resolveEntitlements).toHaveBeenCalledWith(mockCtx);
      expect(dataOf(response)).toEqual({
        orgId: null,
        entitlements: ['flashcards', 'quiz'],
        limits: RESOLVED.limits,
        plan: { primary: 'free', sources: [{ planKey: 'free', origin: 'personal' }] },
      });
    });

    // `orgId` is the wire contract the area gate compares against in 6b; this
    // slice only publishes it. A null here means "personal".
    it('echoes the active org id the set was resolved for', async () => {
      const inOrgCtx: RequestContext = { ...mockCtx, activeOrgId: 'org-7', orgRoleId: 'role-7' };

      expect(dataOf(await controller.myEntitlements(inOrgCtx))?.orgId).toBe('org-7');
    });

    // A quota-0 key must not be visible (§6.1) and the limit that hid it must be
    // readable from the same payload, or the UI has to ask a second endpoint and
    // the two answers can disagree. That the record carries *every* limit key is
    // the resolver's contract, pinned in `entitlement.resolver.limits.test.ts`;
    // here only the pass-through is this layer's job.
    it('passes the resolver record through unchanged, including a quota-0 key', async () => {
      const hidden = { ...RESOLVED.limits, max_quiz_attempts_per_day: 0 };
      vi.mocked(resolveEntitlements).mockResolvedValue({
        ...RESOLVED,
        entitlements: ['flashcards'],
        limits: hidden,
      });

      const data = dataOf(await controller.myEntitlements(mockCtx));

      expect(data?.limits).toEqual(hidden);
      expect(data?.limits.max_quiz_attempts_per_day).toBe(0);
      expect(data?.entitlements).not.toContain('quiz');
    });
  });
});
