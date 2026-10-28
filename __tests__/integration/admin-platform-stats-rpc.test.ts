import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createServiceClient } from '#test/integration/helpers';

// #663: admin_platform_stats / admin_daily_stats read across every tenant, so they are granted to
// the service role only. A signed-in teacher must not be able to call them.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

describe('admin platform statistics RPCs (#663)', () => {
  const service = createServiceClient();
  let teacher: SupabaseClient;

  beforeAll(async () => {
    teacher = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await teacher.auth.signInWithPassword({
      email: 'teacher1@dev.local',
      password: 'pass',
    });
    if (error) throw new Error(`sign-in failed: ${error.message}`);
  });

  it('answers the platform numbers to the service role', async () => {
    const { data, error } = await service.rpc('admin_platform_stats');

    expect(error).toBeNull();
    expect(data.users.total).toBeGreaterThan(0);
    expect(data.organizations).toBeGreaterThan(0);
    expect(typeof data.storage.bytes).toBe('number');
    expect(data.active.last30Days).toBeGreaterThanOrEqual(data.active.last7Days);
  });

  it('answers every day of the window, in order, zeros included', async () => {
    const { data, error } = await service.rpc('admin_daily_stats', { p_days: 14 });

    expect(error).toBeNull();
    expect(data.days).toBe(14);
    expect(data.items).toHaveLength(14);
    const dates: string[] = data.items.map((item: { date: string }) => item.date);
    expect([...dates].sort()).toEqual(dates);
    expect(new Set(dates).size).toBe(14);
  });

  it('keeps the window between 1 and 365 days', async () => {
    const wide = await service.rpc('admin_daily_stats', { p_days: 9999 });
    const narrow = await service.rpc('admin_daily_stats', { p_days: 0 });

    expect(wide.data.items).toHaveLength(365);
    expect(narrow.data.items).toHaveLength(1);
  });

  it.each([
    ['admin_platform_stats', {}],
    ['admin_daily_stats', { p_days: 30 }],
  ])('%s is not callable by a signed-in user', async (fn, args) => {
    const { data, error } = await teacher.rpc(fn, args);

    expect(data).toBeNull();
    expect(error?.code).toBe('42501');
  });
});
