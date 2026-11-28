import type { RequestContext } from '@studiq/authz';
import { accessibleFilter, Permission } from '@studiq/server/lib/authz';
import { applyAccessFilter } from '@studiq/server/lib/query-list';
import { isImpossibleFilter } from '@studiq/server/lib/rbac-filter';
import { failure, isFailure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

/**
 * The ids among `topicIds` that the caller can read (`topic.read`, the topic list's own
 * filter). A caller links only such a topic to their content: the RLS policies of the link
 * tables do not enforce this (#1515, #1541).
 */
export async function readableTopicIds(
  supabase: SupabaseClient<Database>,
  topicIds: readonly string[],
  ctx: RequestContext,
): Promise<ServiceResult<Set<string>>> {
  const readable = new Set<string>();
  if (topicIds.length === 0) return success(readable);

  const filter = await accessibleFilter(ctx, Permission.TOPIC_READ, 'topic');
  if (isImpossibleFilter(filter)) return success(readable);

  const { data, error } = await applyAccessFilter(
    supabase
      .from('topics')
      .select('id')
      .in('id', [...topicIds]),
    filter,
  );
  if (error) return toDbFailure(error);
  for (const topic of dbRows(data)) readable.add(topic.id);
  return success(readable);
}

/** The items a write changes, and a reader of the topic links they already have. */
export interface CarriedTopics {
  itemIds: readonly string[];
  readLinks(
    topicIds: string[],
  ): Promise<ServiceResult<ReadonlyArray<{ itemId: string; topicId: string }>>>;
}

/**
 * Guards new topic links. A topic that every item in `carried` already has passes, so an
 * editor can save an item without being able to read the topics it came with. A missing and
 * an unreadable id are both `NOT_FOUND`.
 */
export async function assertTopicsLinkable(
  supabase: SupabaseClient<Database>,
  topicIds: readonly string[],
  ctx: RequestContext,
  carried?: CarriedTopics,
): Promise<ServiceResult<never> | null> {
  const requested = [...new Set(topicIds)];
  const readable = await readableTopicIds(supabase, requested, ctx);
  if (isFailure(readable)) return readable;

  const unreadable = requested.filter((id) => !readable.data.has(id));
  if (unreadable.length === 0) return null;
  if (!carried || carried.itemIds.length === 0) return failure('NOT_FOUND');

  const links = await carried.readLinks(unreadable);
  if (isFailure(links)) return links;

  const linked = new Set(links.data.map((link) => `${link.itemId}:${link.topicId}`));
  const carriedByAll = unreadable.every((topicId) =>
    carried.itemIds.every((itemId) => linked.has(`${itemId}:${topicId}`)),
  );
  return carriedByAll ? null : failure('NOT_FOUND');
}
