import type { RequestContext } from '@studiq/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { StudentInsights } from '@studiq/server/models/student-insights.model';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

/**
 * `get_student_insights` returns `jsonb`, so the generated type is `Json`. This
 * predicate asserts the shape the SQL function builds (see
 * `99_rpc_functions.sql`) before it is served as `StudentInsights`.
 */
function isStudentInsights(value: unknown): value is StudentInsights {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.days === 'number' &&
    typeof candidate.studyTime === 'object' &&
    candidate.studyTime !== null &&
    Array.isArray(candidate.mastery) &&
    Array.isArray(candidate.retention)
  );
}

/**
 * Study time, topic mastery and the retention curve of the caller (#657). The numbers are
 * aggregated in SQL (`get_student_insights`, the caller's own rows only) because they span
 * every review and answer of the window.
 */
export class StudentInsightsService {
  constructor(private clientFactory: () => Promise<SupabaseClient<Database>>) {}

  async getInsights(ctx: RequestContext, days = 30): Promise<ServiceResult<StudentInsights>> {
    const supabase = await this.clientFactory();

    const { data, error } = await supabase.rpc('get_student_insights', {
      p_user_id: ctx.userId,
      p_days: days,
    });

    if (error) return toDbFailure(error);

    // A null or unexpected payload reports "nothing measured" for the requested
    // window instead of a shape the client cannot read.
    if (!isStudentInsights(data)) {
      return success({
        days,
        studyTime: { totalMs: 0, activeDays: 0, avgMsPerActiveDay: 0, byDay: [], byWeekday: [] },
        mastery: [],
        retention: [],
      });
    }

    return success(data);
  }
}

export const studentInsightsService = wrapService(
  new StudentInsightsService(createClient),
  'student-insights.service',
);
