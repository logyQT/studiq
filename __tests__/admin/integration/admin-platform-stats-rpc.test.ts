import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createServiceClient } from '#test/integration/helpers';
import { asJson } from '#test/helpers/json';

// #663: admin_platform_stats / admin_daily_stats read across every tenant, so they are granted to
// the service role only. A signed-in teacher must not be able to call them.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Shape of `admin_platform_stats()` (supabase/migrations/20261027120000_admin_platform_stats.sql). */
type PlatformStats = {
  users: { total: number; deleted: number; newLast7Days: number; newLast30Days: number };
  organizations: number;
  groups: number;
  storage: { bytes: number };
  active: { last7Days: number; last30Days: number };
};

/** Shape of `admin_daily_stats(p_days)` — only the fields these tests read. */
type DailyStats = { days: number; items: Array<{ date: string }> };

describe('admin platform statistics RPCs (#663)', () => {
  const service = createServiceClient();
  // Untyped on purpose: the table of RPC names below is dynamic, which the generated
  // function signatures cannot narrow; the results are typed at the read sites.
  const teacher = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  beforeAll(async () => {
    const { error } = await teacher.auth.signInWithPassword({
      email: 'teacher1@dev.local',
      password: 'pass',
    });
    if (error) throw new Error(`sign-in failed: ${error.message}`);
  });

  it('answers the platform numbers to the service role', async () => {
    const response = await service.rpc('admin_platform_stats');
    const stats = asJson<PlatformStats>(response.data);

    expect(response.error).toBeNull();
    expect(stats.users.total).toBeGreaterThan(0);
    expect(stats.organizations).toBeGreaterThan(0);
    expect(typeof stats.storage.bytes).toBe('number');
    expect(stats.active.last30Days).toBeGreaterThanOrEqual(stats.active.last7Days);
  });

  it('answers every day of the window, in order, zeros included', async () => {
    const response = await service.rpc('admin_daily_stats', { p_days: 14 });
    const stats = asJson<DailyStats>(response.data);

    expect(response.error).toBeNull();
    expect(stats.days).toBe(14);
    expect(stats.items).toHaveLength(14);
    const dates = stats.items.map((item) => item.date);
    expect([...dates].toSorted()).toEqual(dates);
    expect(new Set(dates).size).toBe(14);
  });

  it('keeps the window between 1 and 365 days', async () => {
    const wide = asJson<DailyStats>(
      (await service.rpc('admin_daily_stats', { p_days: 9999 })).data,
    );
    const narrow = asJson<DailyStats>((await service.rpc('admin_daily_stats', { p_days: 0 })).data);

    expect(wide.items).toHaveLength(365);
    expect(narrow.items).toHaveLength(1);
  });

  it.each([
    ['admin_platform_stats', {}],
    ['admin_daily_stats', { p_days: 30 }],
  ] as const)('%s is not callable by a signed-in user', async (fn, args) => {
    const response = await teacher.rpc(fn, args);

    expect(response.data).toBeNull();
    expect(asJson<{ code?: string } | null>(response.error)?.code).toBe('42501');
  });
});
