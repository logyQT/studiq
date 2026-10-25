import type { RequestContext } from '@studiq/authz';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUsageMock = vi.fn();

vi.mock('@studiq/server/services/limits.resolver', () => ({
  AI_TOKENS_LIMIT_KEY: 'max_ai_tokens_per_day',
  limitsResolver: {
    getUsage: (...args: unknown[]) => getUsageMock(...args),
  },
}));

import { AiUsageController } from '@studiq/server/controllers/ai-usage.controller';

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

const usage = {
  current: 1200,
  limit: 200000,
  plan: 'ace',
  resetsAt: '2026-10-26T00:00:00.000Z',
};

describe('AiUsageController', () => {
  let controller: AiUsageController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new AiUsageController();
    getUsageMock.mockResolvedValue(usage);
  });

  describe('myUsage', () => {
    it('returns the caller usage resolved with the shared limit key', async () => {
      const response = await controller.myUsage(mockCtx);

      expect(getUsageMock).toHaveBeenCalledWith(mockCtx, 'max_ai_tokens_per_day');
      expect(response).toEqual({ success: true, statusCode: 200, data: usage });
    });

    it('propagates a resolver failure (withAuth maps it to a response)', async () => {
      getUsageMock.mockRejectedValueOnce(new Error('db down'));

      await expect(controller.myUsage(mockCtx)).rejects.toThrow('db down');
    });
  });
});
