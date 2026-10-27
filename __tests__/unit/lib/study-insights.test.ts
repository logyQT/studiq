import { AccountType, type RequestContext } from '@studiq/authz';
import { StudentInsightsController } from '@studiq/server/controllers/student-insights.controller';
import { failure, success } from '@studiq/server/lib/service-result';
import {
  type StudentInsights,
  StudentInsightsQuerySchema,
  type TopicMasteryItem,
} from '@studiq/server/models/student-insights.model';
import { StudentInsightsService } from '@studiq/server/services/student-insights.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  busiestWeekday,
  masteryLevel,
  MIN_BUCKET_REVIEWS,
  retentionSample,
  splitDuration,
  visibleMastery,
  weekdayNames,
} from '@/lib/study-insights';

// #657: study time, topic mastery and the retention curve on the student statistics pages.

describe('splitDuration', () => {
  it('splits milliseconds into hours and minutes, rounded to the minute', () => {
    expect(splitDuration(0)).toEqual({ hours: 0, minutes: 0 });
    expect(splitDuration(45 * 60 * 1000)).toEqual({ hours: 0, minutes: 45 });
    expect(splitDuration(75 * 60 * 1000)).toEqual({ hours: 1, minutes: 15 });
    expect(splitDuration(4_500_000)).toEqual({ hours: 1, minutes: 15 });
    expect(splitDuration(89 * 1000)).toEqual({ hours: 0, minutes: 1 });
  });

  it('never goes negative', () => {
    expect(splitDuration(-5000)).toEqual({ hours: 0, minutes: 0 });
  });
});

describe('busiestWeekday', () => {
  it('is the index of the weekday with the most study time, Monday = 0', () => {
    expect(busiestWeekday([0, 0, 0, 1800000, 300000, 1200000, 600000])).toBe(3);
  });

  it('prefers the earlier weekday on a tie', () => {
    expect(busiestWeekday([5, 9, 9, 0, 0, 0, 0])).toBe(1);
  });

  it('is null without any study', () => {
    expect(busiestWeekday([0, 0, 0, 0, 0, 0, 0])).toBeNull();
    expect(busiestWeekday([])).toBeNull();
  });
});

describe('weekdayNames', () => {
  it('starts on Monday in the given locale', () => {
    expect(weekdayNames('en', 'long')).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
    expect(weekdayNames('pl', 'long')[0]).toBe('poniedziałek');
    expect(weekdayNames('pl')).toHaveLength(7);
  });
});

describe('retentionSample', () => {
  it('adds up the reviews of every bucket', () => {
    expect(
      retentionSample([
        { bucket: 'd0', reviews: 0, accuracy: null },
        { bucket: 'd1', reviews: 3, accuracy: 100 },
        { bucket: 'd2_3', reviews: 4, accuracy: 50 },
      ]),
    ).toBe(7);
    expect(retentionSample([])).toBe(0);
  });

  it('treats fewer than the minimum as too thin to read', () => {
    expect(MIN_BUCKET_REVIEWS).toBeGreaterThan(1);
  });
});

const topic = (over: Partial<TopicMasteryItem>): TopicMasteryItem => ({
  topicId: 't',
  name: 'T',
  quizAnswers: 0,
  quizAccuracy: null,
  flashcardReviews: 0,
  flashcardAccuracy: null,
  accuracy: 0,
  ...over,
});

describe('visibleMastery', () => {
  it('orders by volume, then by name, and drops topics without activity', () => {
    const list = visibleMastery([
      topic({ topicId: 'a', name: 'Beta', quizAnswers: 2 }),
      topic({ topicId: 'b', name: 'Alfa', quizAnswers: 2 }),
      topic({ topicId: 'c', name: 'Gamma', flashcardReviews: 9 }),
      topic({ topicId: 'd', name: 'Empty' }),
    ]);
    expect(list.map((t) => t.name)).toEqual(['Gamma', 'Alfa', 'Beta']);
  });

  it('shows at most the requested number of topics', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      topic({ topicId: String(i), name: `T${i}`, quizAnswers: 1 }),
    );
    expect(visibleMastery(many)).toHaveLength(10);
    expect(visibleMastery(many, 3)).toHaveLength(3);
  });

  it('does not change the list it was given', () => {
    const input = [topic({ name: 'B', quizAnswers: 1 }), topic({ name: 'A', quizAnswers: 5 })];
    visibleMastery(input);
    expect(input.map((t) => t.name)).toEqual(['B', 'A']);
  });
});

describe('masteryLevel', () => {
  it.each([
    [0, 'low'],
    [49, 'low'],
    [50, 'medium'],
    [79, 'medium'],
    [80, 'high'],
    [100, 'high'],
  ])('%d%% is %s', (accuracy, level) => {
    expect(masteryLevel(accuracy)).toBe(level);
  });
});

describe('StudentInsightsQuerySchema', () => {
  it('defaults to 30 days and coerces the query string', () => {
    expect(StudentInsightsQuerySchema.parse({})).toEqual({ days: 30 });
    expect(StudentInsightsQuerySchema.parse({ days: '90' })).toEqual({ days: 90 });
  });

  it.each([{ days: '0' }, { days: '366' }, { days: 'abc' }, { days: '1.5' }])(
    'rejects %j',
    (query) => {
      expect(StudentInsightsQuerySchema.safeParse(query).success).toBe(false);
    },
  );
});

const ctx: RequestContext = {
  userId: 'student-1',
  accountType: AccountType.STUDENT,
  traceId: 't',
  url: '',
  method: 'GET',
  activeOrgId: null,
  orgRoleId: null,
  groupIds: [],
  permissionScopes: {},
};

const insights: StudentInsights = {
  days: 30,
  studyTime: {
    totalMs: 0,
    activeDays: 0,
    avgMsPerActiveDay: 0,
    byDay: [],
    byWeekday: [0, 0, 0, 0, 0, 0, 0],
  },
  mastery: [],
  retention: [],
};

describe('StudentInsightsService', () => {
  const rpc = vi.fn();
  const service = new StudentInsightsService(async () => ({ rpc }) as any);

  beforeEach(() => vi.clearAllMocks());

  it('asks the database for the caller and the window', async () => {
    rpc.mockResolvedValue({ data: insights, error: null });

    const result = await service.getInsights(ctx, 90);

    expect(rpc).toHaveBeenCalledWith('get_student_insights', {
      p_user_id: 'student-1',
      p_days: 90,
    });
    expect(result.success && result.data).toEqual(insights);
  });

  it('defaults to 30 days', async () => {
    rpc.mockResolvedValue({ data: insights, error: null });

    await service.getInsights(ctx);

    expect(rpc).toHaveBeenCalledWith('get_student_insights', {
      p_user_id: 'student-1',
      p_days: 30,
    });
  });

  it('fails when the database does', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } });

    expect((await service.getInsights(ctx)).success).toBe(false);
  });
});

describe('StudentInsightsController', () => {
  const insightsService = { getInsights: vi.fn() };
  const controller = new StudentInsightsController(insightsService as any);

  beforeEach(() => vi.clearAllMocks());

  it('passes the parsed window to the service', async () => {
    insightsService.getInsights.mockResolvedValue(success(insights));

    const response = await controller.getInsights({ days: '7' }, ctx);

    expect(insightsService.getInsights).toHaveBeenCalledWith(ctx, 7);
    expect(response).toMatchObject({ success: true, statusCode: 200 });
  });

  it('answers 422 for an invalid window without calling the service', async () => {
    const response = await controller.getInsights({ days: '0' }, ctx);

    expect(response).toMatchObject({ success: false, statusCode: 422 });
    expect(insightsService.getInsights).not.toHaveBeenCalled();
  });

  it('maps a service failure to its HTTP error', async () => {
    insightsService.getInsights.mockResolvedValue(failure('INTERNAL_SERVER'));

    expect(await controller.getInsights({}, ctx)).toMatchObject({
      success: false,
      statusCode: 500,
    });
  });
});
