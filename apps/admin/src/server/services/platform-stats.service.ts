import { createClient } from '@admin/lib/supabase/admin-client';
import type { DailyStats, PlatformStats } from '@admin/server/models/platform-stats.model';
import { wrapService } from '@studiq/server/lib/observability';
import { type ServiceResult, success } from '@studiq/server/lib/service-result';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Platform-wide numbers for the admin dashboard (#663). The aggregation is SQL
 * (`admin_platform_stats`, `admin_daily_stats`): it reads every tenant, so those functions are
 * granted to the service role only, which is what the admin app connects as.
 */
export class PlatformStatsService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async getPlatformStats(): Promise<ServiceResult<PlatformStats>> {
    const supabase = await this.createClient();
    const { data, error } = await supabase.rpc('admin_platform_stats');

    if (error) return toDbFailure(error);
    return success(data as PlatformStats);
  }

  async getDailyStats(days = 30): Promise<ServiceResult<DailyStats>> {
    const supabase = await this.createClient();
    const { data, error } = await supabase.rpc('admin_daily_stats', { p_days: days });

    if (error) return toDbFailure(error);
    return success(data as DailyStats);
  }
}

export const platformStatsService = wrapService(
  new PlatformStatsService(createClient),
  'platform-stats.service',
);
