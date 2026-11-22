import { FeaturesController } from '@studiq/server/controllers/features.controller';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@studiq/server/lib/entitlements', () => ({
  resolveEntitlements: vi.fn(),
}));

import {
  AccountType,
  LIMIT_KEYS,
  type RequestContext,
  type ResolvedEntitlements,
} from '@studiq/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
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

describe('FeaturesController', () => {
  let controller: FeaturesController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new FeaturesController();
    vi.mocked(resolveEntitlements).mockResolvedValue({
      entitlements: ['flashcards', 'quiz'],
      limits: Object.fromEntries(LIMIT_KEYS.map((key) => [key, -1])),
      sources: {
        org: null,
        seat: null,
        personal: null,
        overrides: [],
        revokedOverrides: [],
        revokedRoleRows: [],
        flagsOff: [],
      },
      plan: { primary: 'free', sources: [] },
    } satisfies ResolvedEntitlements);
  });

  describe('myFeatures', () => {
    it('returns the resolved entitlement keys as `features`', async () => {
      const response = await controller.myFeatures(mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect(resolveEntitlements).toHaveBeenCalledWith(mockCtx);
      expect(dataOf(response)).toEqual({
        features: ['flashcards', 'quiz'],
      });
    });
  });
});
