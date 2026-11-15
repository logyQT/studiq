import type { SupabaseClient } from '@supabase/supabase-js';
import { type ServiceResult, success } from '@studiq/server/lib/service-result';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { Database } from '@studiq/server/types/database';

/**
 * Item states (#1171): `open` items may be bound to an assessment, `retired` ones may not, and
 * `deleted` ones are hidden from authoring and practice. The row survives a delete so an item a
 * live assessment already bound is not destroyed.
 */

/**
 * Ids of the given questions that may be newly bound to an assessment: only `open` items.
 * A retired item still shows in authoring (it can be reopened) but a new binding is refused;
 * a deleted item is not even in the pool.
 */
export async function openQuestionIds(
  supabase: SupabaseClient<Database>,
  questionIds: readonly string[],
): Promise<ServiceResult<Set<string>>> {
  const ids = [...new Set(questionIds)];
  if (ids.length === 0) return success(new Set<string>());

  const { data, error } = await supabase
    .from('questions')
    .select('id')
    .in('id', ids)
    .eq('status', 'open');

  if (error) return toDbFailure(error);
  return success(new Set(dbRows(data).map((row) => row.id)));
}
