import { AccountType, type RequestContext } from '@studiq/authz';
import { FlashcardPracticeController } from '@studiq/server/controllers/flashcard-practice.controller';
import { failure, success } from '@studiq/server/lib/service-result';
import {
  MAX_DAILY_REVIEW_GOAL,
  UpdateStudySettingsSchema,
} from '@studiq/server/models/study-settings.model';
import { FlashcardPracticeService } from '@studiq/server/services/flashcard-practice.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GOAL_PRESETS, goalProgress, MAX_GOAL, parseGoalInput } from '@/lib/goal-progress';

// #656: the daily review goal. The column and the chart line existed; nothing could set the
// goal and nothing showed progress towards it.

vi.mock('@studiq/server/lib/authz', () => ({
  buildQueryFilter: vi.fn(() => ({})),
  Permission: { FLASHCARD_READ: 'flashcard.read' },
}));

const ctx: RequestContext = {
  userId: 'student-1',
  accountType: AccountType.STUDENT,
  traceId: 't',
  url: '',
  method: 'PUT',
  activeOrgId: null,
  orgRoleId: null,
  groupIds: [],
  permissionScopes: {},
};

describe('UpdateStudySettingsSchema', () => {
  it.each([0, 1, 30, MAX_DAILY_REVIEW_GOAL])('accepts %d', (dailyReviewGoal) => {
    expect(UpdateStudySettingsSchema.safeParse({ dailyReviewGoal }).success).toBe(true);
  });

  it.each([
    ['negative', -1],
    ['too big', MAX_DAILY_REVIEW_GOAL + 1],
    ['fractional', 2.5],
    ['text', '30'],
    ['null', null],
  ])('rejects %s', (_name, dailyReviewGoal) => {
    expect(UpdateStudySettingsSchema.safeParse({ dailyReviewGoal }).success).toBe(false);
  });

  it('needs the field', () => {
    expect(UpdateStudySettingsSchema.safeParse({}).success).toBe(false);
  });

  it('ignores fields a student may not change', () => {
    const parsed = UpdateStudySettingsSchema.parse({ dailyReviewGoal: 5, leechThreshold: 1 });
    expect(parsed).toEqual({ dailyReviewGoal: 5 });
  });
});

/** A thenable query builder that resolves to `result` whatever is chained on it. */
function builder(result: Record<string, unknown>) {
  const b: any = {};
  for (const m of ['select', 'eq', 'update', 'insert', 'order', 'limit']) b[m] = vi.fn(() => b);
  b.single = vi.fn().mockResolvedValue(result);
  b.maybeSingle = vi.fn().mockResolvedValue(result);
  b.then = (onfulfilled: any) => Promise.resolve(result).then(onfulfilled);
  return b;
}

describe('FlashcardPracticeService settings', () => {
  const today = new Date().toISOString().split('T')[0];
  let tables: Record<string, any>;
  let service: FlashcardPracticeService;
  const rpc = vi.fn();

  const settingsRow = {
    user_id: 'student-1',
    learning_steps: [1, 10],
    new_cards_per_day: 20,
    new_cards_introduced: 0,
    leech_threshold: 8,
    daily_reset_date: today,
    daily_review_goal: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: 0, error: null });
    tables = {
      user_study_settings: builder({ data: settingsRow, error: null }),
      user_daily_activity: builder({ data: { reviews_count: 12 }, error: null }),
    };
    service = new FlashcardPracticeService(
      async () => ({ from: vi.fn((table: string) => tables[table]), rpc }) as any,
    );
  });

  it("reports the goal and today's reviews with the settings", async () => {
    tables.user_study_settings = builder({
      data: { ...settingsRow, daily_review_goal: 30 },
      error: null,
    });

    const result = await service.getSettings(ctx);

    expect(result.success && result.data).toMatchObject({
      dailyReviewGoal: 30,
      reviewedToday: 12,
    });
    expect(tables.user_daily_activity.eq).toHaveBeenCalledWith('user_id', 'student-1');
    expect(tables.user_daily_activity.eq).toHaveBeenCalledWith('date', today);
  });

  it('reports 0 reviews when nothing was reviewed today', async () => {
    tables.user_daily_activity = builder({ data: null, error: null });

    const result = await service.getSettings(ctx);

    expect(result.success && (result.data as any).reviewedToday).toBe(0);
  });

  it('stores the goal for the caller only and answers the fresh settings', async () => {
    const result = await service.updateSettings(ctx, { dailyReviewGoal: 40 });

    const settings = tables.user_study_settings;
    expect(settings.update).toHaveBeenCalledWith({ daily_review_goal: 40 });
    expect(settings.eq).toHaveBeenCalledWith('user_id', 'student-1');
    expect(result.success && result.data).toMatchObject({ reviewedToday: 12 });
  });

  it('fails when the update fails', async () => {
    // The row exists (first read); the update is a separate builder that errors.
    const settings = builder({ data: settingsRow, error: null });
    settings.update = vi.fn(() =>
      builder({ data: null, error: { code: 'XX000', message: 'boom' } }),
    );
    tables.user_study_settings = settings;

    const result = await service.updateSettings(ctx, { dailyReviewGoal: 40 });

    expect(result.success).toBe(false);
  });
});

describe('FlashcardPracticeController.updateSettings', () => {
  const practice = { updateSettings: vi.fn() };
  const controller = new FlashcardPracticeController(practice as any);

  beforeEach(() => vi.clearAllMocks());

  it('passes the parsed goal to the service', async () => {
    practice.updateSettings.mockResolvedValue(success({ dailyReviewGoal: 25 }));

    const response = await controller.updateSettings({ dailyReviewGoal: 25 }, ctx);

    expect(practice.updateSettings).toHaveBeenCalledWith(ctx, { dailyReviewGoal: 25 });
    expect(response).toMatchObject({ success: true, statusCode: 200 });
  });

  it.each([{ dailyReviewGoal: -5 }, { dailyReviewGoal: 5000 }, {}, null])(
    'answers 422 for %j without calling the service',
    async (body) => {
      const response = await controller.updateSettings(body, ctx);

      expect(response).toMatchObject({ success: false, statusCode: 422 });
      expect(practice.updateSettings).not.toHaveBeenCalled();
    },
  );

  it('maps a service failure to its HTTP error', async () => {
    practice.updateSettings.mockResolvedValue(failure('INTERNAL_SERVER'));

    expect(await controller.updateSettings({ dailyReviewGoal: 5 }, ctx)).toMatchObject({
      success: false,
      statusCode: 500,
    });
  });
});

describe('goalProgress', () => {
  it('is disabled without a goal', () => {
    expect(goalProgress(7, 0)).toEqual({
      enabled: false,
      done: 7,
      goal: 0,
      remaining: 0,
      percent: 0,
      reached: false,
    });
  });

  it('measures today against the goal', () => {
    expect(goalProgress(12, 30)).toEqual({
      enabled: true,
      done: 12,
      goal: 30,
      remaining: 18,
      percent: 40,
      reached: false,
    });
  });

  it('is reached at the goal and the bar stops at 100 % beyond it', () => {
    expect(goalProgress(30, 30)).toMatchObject({ reached: true, remaining: 0, percent: 100 });
    expect(goalProgress(45, 30)).toMatchObject({ reached: true, remaining: 0, percent: 100 });
  });

  it('clamps negative and fractional input', () => {
    expect(goalProgress(-4, 10)).toMatchObject({ done: 0, percent: 0 });
    expect(goalProgress(3.9, 10.8)).toMatchObject({ done: 3, goal: 10 });
  });
});

describe('parseGoalInput', () => {
  it.each([
    ['0', 0],
    ['30', 30],
    [' 50 ', 50],
    [String(MAX_GOAL), MAX_GOAL],
  ])('reads %j as %d', (raw, expected) => {
    expect(parseGoalInput(raw)).toBe(expected);
  });

  it.each(['', ' ', '-1', '2.5', '1e3', 'abc', String(MAX_GOAL + 1), '12 3'])(
    'refuses %j',
    (raw) => {
      expect(parseGoalInput(raw)).toBeNull();
    },
  );

  it('keeps the presets inside the allowed range', () => {
    for (const preset of GOAL_PRESETS) expect(parseGoalInput(String(preset))).toBe(preset);
  });

  it('uses the same bound as the API', () => {
    expect(MAX_GOAL).toBe(MAX_DAILY_REVIEW_GOAL);
  });
});
