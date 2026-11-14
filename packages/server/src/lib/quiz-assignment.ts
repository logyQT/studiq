import type { SupabaseClient } from '@supabase/supabase-js';
import { type ServiceResult, success } from '@studiq/server/lib/service-result';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { Database } from '@studiq/server/types/database';

/** One quiz item as both copy paths carry it: the question, its position and its points. */
export interface AssessmentItemLink {
  question_id: string;
  order_index: number | null;
  points: number;
}

/**
 * Links the items of a quiz to a new assessment. Both copy paths run `openQuestionIds` over the
 * whole quiz first, so a retired or deleted item refuses the copy instead of being dropped here.
 */
export async function insertAssessmentItemLinks(
  supabase: SupabaseClient<Database>,
  assignmentId: string,
  items: readonly AssessmentItemLink[],
): Promise<ServiceResult<number>> {
  if (items.length === 0) return success(0);

  const { error } = await supabase.from('assignment_questions').insert(
    items.map((item) => ({
      assignment_id: assignmentId,
      question_id: item.question_id,
      order_index: item.order_index,
      points: item.points,
    })),
  );

  if (error) return toDbFailure(error);
  return success(items.length);
}
