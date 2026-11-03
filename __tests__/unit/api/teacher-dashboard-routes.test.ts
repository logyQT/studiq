import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const groups = vi.fn<(...args: unknown[]) => unknown>();
const feed = vi.fn<(...args: unknown[]) => unknown>();
const ctx = { userId: 'teacher-1', activeOrgId: 'org-1' };
const authOptions = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('@studiq/server/controllers/stats.controller', () => ({
  statsController: {
    getTeacherGroupPerformance: (...args: unknown[]) => groups(...args),
    getTeacherActivityFeed: (...args: unknown[]) => feed(...args),
  },
}));

vi.mock('@studiq/server/lib/with-auth', () => ({
  withAuth: async (
    _req: unknown,
    handler: (context: typeof ctx) => Promise<Response>,
    options: unknown,
  ) => {
    authOptions(options);
    return handler(ctx);
  },
}));

import { GET as getFeed } from '@/app/(backend)/api/v1/stats/teacher/feed/route';
import { GET as getGroups } from '@/app/(backend)/api/v1/stats/teacher/groups/route';

describe('teacher dashboard routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['groups', getGroups, groups, 'days', '365'],
    ['feed', getFeed, feed, 'limit', '50'],
  ])(
    '%s restricts roles and forwards the query and context',
    async (path, get, controller, key, value) => {
      const data = [{ id: 'item-1' }];
      controller.mockResolvedValue({ success: true, statusCode: 200, data });

      const response = await get(
        new NextRequest(`http://localhost/api/v1/stats/teacher/${path}?${key}=${value}`),
      );

      expect(authOptions).toHaveBeenCalledWith({ allowedAccountTypes: ['educator', 'manager'] });
      expect(controller).toHaveBeenCalledWith({ [key]: value }, ctx);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true, data });
    },
  );

  it.each([
    ['groups', getGroups, groups],
    ['feed', getFeed, feed],
  ])('%s propagates controller errors', async (path, get, controller) => {
    controller.mockResolvedValue({ success: false, statusCode: 403, error: 'FORBIDDEN' });

    const response = await get(new NextRequest(`http://localhost/${path}`));

    expect(controller).toHaveBeenCalledWith({}, ctx);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ success: false, error: 'FORBIDDEN' });
  });
});
