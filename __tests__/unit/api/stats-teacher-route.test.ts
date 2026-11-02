import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const teacherStatsMock = vi.fn<(req: NextRequest) => Promise<unknown>>();
const activityMock = vi.fn<(req: NextRequest) => Promise<unknown>>();
const flashcardTeacherStatsMock = vi.fn<(req: NextRequest) => Promise<unknown>>();
const difficultyMock = vi.fn<(req: NextRequest) => Promise<unknown>>();

vi.mock('@studiq/server/controllers/stats.controller', () => ({
  statsController: { getTeacherStats: (req: NextRequest) => teacherStatsMock(req) },
}));

vi.mock('@studiq/server/controllers/activity.controller', () => ({
  activityController: { getActivity: (req: NextRequest) => activityMock(req) },
}));

vi.mock('@studiq/server/controllers/flashcard-stats.controller', () => ({
  flashcardStatsController: {
    getTeacherStats: (req: NextRequest) => flashcardTeacherStatsMock(req),
    getDifficultyCards: (req: NextRequest) => difficultyMock(req),
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
      () => teacherGet(new NextRequest('http://localhost/api/v1/stats/teacher')),
    ],
    [
      'GET /api/v1/stats/teacher/activity',
      () => activityGet(new NextRequest('http://localhost/api/v1/stats/teacher/activity')),
    ],
    [
      'GET /api/v1/flashcards/stats/teacher',
      () => flashcardStatsGet(new NextRequest('http://localhost/api/v1/flashcards/stats/teacher')),
    ],
    [
      'GET /api/v1/flashcards/stats/teacher/difficulty/[bucket]',
      () =>
        difficultyGet(
          new NextRequest('http://localhost/api/v1/flashcards/stats/teacher/difficulty/easy'),
          {
            params: Promise.resolve({ bucket: 'easy' }),
          },
        ),
    ],
  ])('%s allows educators and managers only', async (_name, call) => {
    const res = await call();

    expect(res.status).toBe(200);
    expect(withAuthCalls).toBe(1);
    expect(capturedOptions?.allowedAccountTypes).toEqual(['educator', 'manager']);
  });
});
