import { FeaturesController } from '@studiq/server/controllers/features.controller';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/features', () => ({
  resolveFeatures: vi.fn(),
}));

import { RequestContext } from '@studiq/authz';
import { resolveFeatures } from '@studiq/server/lib/features';

const mockCtx: RequestContext = {
  traceId: 'test',
  userId: 'u-1',
  accountType: 'student' as any,
  orgRoleId: null,
  activeOrgId: null,
  url: '',
  method: 'GET',
  groupIds: [],
  permissionScopes: {},
};

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
      expect((response as any).data).toEqual({
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
      expect((response as any).data.rollout).toEqual({});
    });
  });
});
