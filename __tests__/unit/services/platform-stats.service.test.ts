import { PlatformStatsController } from '@admin/server/controllers/platform-stats.controller';
import {
  DailyStatsQuerySchema,
  type PlatformStats,
} from '@admin/server/models/platform-stats.model';
import { PlatformStatsService } from '@admin/server/services/platform-stats.service';
import { failure, success } from '@studiq/server/lib/service-result';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { barHeights, formatBytes, formatCount, total } from '@admin/lib/stats-format';

// #663: the admin dashboard's platform numbers. The SQL aggregates are service-role only; the
// service forwards the call, the controller validates the window, and the pure helpers format
// the numbers and scale the daily bars.

const stats: PlatformStats = {
  users: { total: 971, deleted: 2, newLast7Days: 4, newLast30Days: 40 },
  active: { last7Days: 12, last30Days: 84 },
  organizations: 5,
  groups: 9,
  content: {
    decks: 30,
    flashcards: 200,
    questionBanks: 12,
    questions: 56,
    assignments: 3,
    quizAttempts: 17,
  },
  storage: { objects: 1, bytes: 2674 },
};

describe('PlatformStatsService', () => {
  const rpc = vi.fn();
  const service = new PlatformStatsService(async () => ({ rpc }) as any);

  beforeEach(() => vi.clearAllMocks());

  it('reads the platform numbers through the admin aggregate', async () => {
    rpc.mockResolvedValue({ data: stats, error: null });

    const result = await service.getPlatformStats();

    expect(rpc).toHaveBeenCalledWith('admin_platform_stats');
    expect(result.success && result.data).toEqual(stats);
  });

  it('reads the daily series for the requested window', async () => {
    rpc.mockResolvedValue({ data: { days: 90, items: [] }, error: null });

    const result = await service.getDailyStats(90);

    expect(rpc).toHaveBeenCalledWith('admin_daily_stats', { p_days: 90 });
    expect(result.success && result.data).toEqual({ days: 90, items: [] });
  });

  it('defaults to 30 days', async () => {
    rpc.mockResolvedValue({ data: { days: 30, items: [] }, error: null });

    await service.getDailyStats();

    expect(rpc).toHaveBeenCalledWith('admin_daily_stats', { p_days: 30 });
  });

  it('fails when the database does', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });

    expect((await service.getPlatformStats()).success).toBe(false);
    expect((await service.getDailyStats()).success).toBe(false);
  });
});

describe('DailyStatsQuerySchema', () => {
  it('defaults to 30 days and coerces the query string', () => {
    expect(DailyStatsQuerySchema.parse({})).toEqual({ days: 30 });
    expect(DailyStatsQuerySchema.parse({ days: '90' })).toEqual({ days: 90 });
  });

  it.each([{ days: '0' }, { days: '366' }, { days: 'x' }, { days: '2.5' }])('rejects %j', (q) => {
    expect(DailyStatsQuerySchema.safeParse(q).success).toBe(false);
  });
});

describe('PlatformStatsController', () => {
  const platform = { getPlatformStats: vi.fn(), getDailyStats: vi.fn() };
  const controller = new PlatformStatsController(platform as any);

  beforeEach(() => vi.clearAllMocks());

  it('answers 200 with the numbers', async () => {
    platform.getPlatformStats.mockResolvedValue(success(stats));

    expect(await controller.getPlatformStats()).toMatchObject({
      success: true,
      statusCode: 200,
      data: stats,
    });
  });

  it('passes the parsed window to the service', async () => {
    platform.getDailyStats.mockResolvedValue(success({ days: 7, items: [] }));

    await controller.getDailyStats({ days: '7' });

    expect(platform.getDailyStats).toHaveBeenCalledWith(7);
  });

  it('answers 422 for an invalid window without calling the service', async () => {
    expect(await controller.getDailyStats({ days: '0' })).toMatchObject({
      success: false,
      statusCode: 422,
    });
    expect(platform.getDailyStats).not.toHaveBeenCalled();
  });

  it('maps a service failure to its HTTP error', async () => {
    platform.getPlatformStats.mockResolvedValue(failure('INTERNAL_SERVER'));

    expect(await controller.getPlatformStats()).toMatchObject({ success: false, statusCode: 500 });
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1, '1 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [2674, '2.6 KB'],
    [5 * 1024 * 1024, '5.0 MB'],
    [3.5 * 1024 ** 3, '3.5 GB'],
    [2 * 1024 ** 5, '2048.0 TB'],
  ])('%d -> %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });

  it('treats negative and non-finite input as nothing', () => {
    expect(formatBytes(-5)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B');
  });
});

describe('formatCount', () => {
  it('groups thousands in the locale', () => {
    expect(formatCount(1234567, 'en')).toBe('1,234,567');
    expect(formatCount(971, 'pl')).toBe('971');
  });
});

describe('barHeights', () => {
  it('scales to the tallest bar', () => {
    expect(barHeights([0, 5, 10])).toEqual([0, 50, 100]);
  });

  it('keeps a small non-zero day visible', () => {
    expect(barHeights([1, 1000])[0]).toBe(4);
    expect(barHeights([1, 1000], 10)[0]).toBe(10);
  });

  it('is all zero without activity, and for an empty series', () => {
    expect(barHeights([0, 0, 0])).toEqual([0, 0, 0]);
    expect(barHeights([])).toEqual([]);
  });

  it('ignores negative values', () => {
    expect(barHeights([-3, 4])).toEqual([0, 100]);
  });
});

describe('total', () => {
  it('adds a series up', () => {
    expect(total([1, 2, 3])).toBe(6);
    expect(total([])).toBe(0);
  });
});
