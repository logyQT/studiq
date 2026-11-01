import type { RequestContext } from '@studiq/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { StudentInsights } from '@studiq/server/models/student-insights.model';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Study time, topic mastery and the retention curve of the caller (#657). The numbers are
 * aggregated in SQL (`get_student_insights`, the caller's own rows only) because they span
 * every review and answer of the window.
 */
export class StudentInsightsService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async getInsights(ctx: RequestContext, days = 30): Promise<ServiceResult<StudentInsights>> {
    const supabase = await this.createClient();

    const { data, error } = await supabase.rpc('get_student_insights', {
      p_user_id: ctx.userId,
      p_days: days,
    });

    if (error) return toDbFailure(error);
    return success(data as StudentInsights);
  }
}

export const studentInsightsService = wrapService(
  new StudentInsightsService(createClient),
  'student-insights.service',
);
