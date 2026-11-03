import { FeaturesController } from '@studiq/server/controllers/features.controller';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@studiq/server/lib/features', () => ({
  resolveFeatures: vi.fn(),
}));

import { AccountType, type RequestContext } from '@studiq/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { resolveFeatures } from '@studiq/server/lib/features';

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
    vi.mocked(resolveFeatures).mockResolvedValue({
      features: ['flashcards', 'quiz'],
      rollout: { 'ai.chat': 25 },
    });
  });

  describe('myFeatures', () => {
    it('returns enabled features and the rollout map', async () => {
      const response = await controller.myFeatures(mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect(dataOf(response)).toEqual({
        features: ['flashcards', 'quiz'],
        rollout: { 'ai.chat': 25 },
      });
    });

    it('returns an empty rollout when nothing is gated', async () => {
      vi.mocked(resolveFeatures).mockResolvedValueOnce({
        features: ['flashcards'],
        rollout: {},
      });

      const response = await controller.myFeatures(mockCtx);
      expect(dataOf(response)?.rollout).toEqual({});
    });
  });
});
