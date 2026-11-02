import { createClient } from '@admin/lib/supabase/admin-client';
import {
  type DailyStats,
  DailyStatsSchema,
  type PlatformStats,
  PlatformStatsSchema,
} from '@admin/server/models/platform-stats.model';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@studiq/server/types/database';
import type { z } from '@studiq/server/lib/zod';

/**
 * Platform-wide numbers for the admin dashboard (#663). The aggregation is SQL
 * (`admin_platform_stats`, `admin_daily_stats`): it reads every tenant, so those functions are
 * granted to the service role only, which is what the admin app connects as.
 */
export class PlatformStatsService {
  constructor(private clientFactory: () => Promise<SupabaseClient<Database>>) {}

  async getPlatformStats(): Promise<ServiceResult<PlatformStats>> {
    const supabase = await this.clientFactory();
    const { data, error } = await supabase.rpc('admin_platform_stats');

    if (error) return toDbFailure(error);
    return parseStats(PlatformStatsSchema, data);
  }

  async getDailyStats(days = 30): Promise<ServiceResult<DailyStats>> {
    const supabase = await this.clientFactory();
    const { data, error } = await supabase.rpc('admin_daily_stats', { p_days: days });

    if (error) return toDbFailure(error);
    return parseStats(DailyStatsSchema, data);
  }
}

/** The RPC returns untyped `jsonb`; validate it instead of trusting a cast. */
function parseStats<T>(schema: z.ZodType<T>, data: unknown): ServiceResult<T> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) return failure('INTERNAL_SERVER');
  return success(parsed.data);
}

export const platformStatsService = wrapService(
  new PlatformStatsService(createClient),
  'platform-stats.service',
);
