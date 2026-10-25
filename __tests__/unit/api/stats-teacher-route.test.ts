import { beforeEach, describe, expect, it, vi } from 'vitest';

const teacherStatsMock = vi.fn();
const activityMock = vi.fn();
const flashcardTeacherStatsMock = vi.fn();
const difficultyMock = vi.fn();

vi.mock('@studiq/server/controllers/stats.controller', () => ({
  statsController: { getTeacherStats: (...args: unknown[]) => teacherStatsMock(...args) },
}));

vi.mock('@studiq/server/controllers/activity.controller', () => ({
  activityController: { getActivity: (...args: unknown[]) => activityMock(...args) },
}));

vi.mock('@studiq/server/controllers/flashcard-stats.controller', () => ({
  flashcardStatsController: {
    getTeacherStats: (...args: unknown[]) => flashcardTeacherStatsMock(...args),
    getDifficultyCards: (...args: unknown[]) => difficultyMock(...args),
  },
}));

type WithAuthOptions = { allowedAccountTypes?: string[] };
let capturedOptions: WithAuthOptions | undefined;
let withAuthCalls = 0;

vi.mock('@studiq/server/lib/with-auth', () => ({
  withAuth: async (
    _req: unknown,
    handler: (ctx: unknown) => Promise<Response>,
    options?: WithAuthOptions,
  ) => {
    withAuthCalls++;
    capturedOptions = options;
    return handler({ userId: 'u-1', accountType: 'educator', activeOrgId: 'org-1' });
  },
}));

import { GET as activityGet } from '@/app/(backend)/api/v1/stats/teacher/activity/route';
import { GET as difficultyGet } from '@/app/(backend)/api/v1/flashcards/stats/teacher/difficulty/[bucket]/route';
import { GET as flashcardStatsGet } from '@/app/(backend)/api/v1/flashcards/stats/teacher/route';
import { GET as teacherGet } from '@/app/(backend)/api/v1/stats/teacher/route';

const ok = { success: true, statusCode: 200, data: {} };

/**
 * #189: the whole teacher-stats family must be educator/manager-only. The proxy
 * early-returns for /api/*, so `withAuth`'s options are the only enforcement
 * point — asserting the option is the cheapest regression guard.
 */
describe('teacher stats routes — allowed account types (#189)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOptions = undefined;
    withAuthCalls = 0;
    teacherStatsMock.mockResolvedValue(ok);
    activityMock.mockResolvedValue(ok);
    flashcardTeacherStatsMock.mockResolvedValue(ok);
    difficultyMock.mockResolvedValue(ok);
  });

  it.each([
    [
      'GET /api/v1/stats/teacher',
      () => teacherGet(new Request('http://localhost/api/v1/stats/teacher') as never),
    ],
    [
      'GET /api/v1/stats/teacher/activity',
      () => activityGet(new Request('http://localhost/api/v1/stats/teacher/activity') as never),
    ],
    [
      'GET /api/v1/flashcards/stats/teacher',
      () =>
        flashcardStatsGet(new Request('http://localhost/api/v1/flashcards/stats/teacher') as never),
    ],
    [
      'GET /api/v1/flashcards/stats/teacher/difficulty/[bucket]',
      () =>
        difficultyGet(
          new Request('http://localhost/api/v1/flashcards/stats/teacher/difficulty/easy') as never,
          {
            params: Promise.resolve({ bucket: 'easy' }),
          } as never,
        ),
    ],
  ])('%s allows educators and managers only', async (_name, call) => {
    const res = await call();

    expect(res.status).toBe(200);
    expect(withAuthCalls).toBe(1);
    expect(capturedOptions?.allowedAccountTypes).toEqual(['educator', 'manager']);
  });
});
