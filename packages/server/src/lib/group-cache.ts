import { createClient } from '@studiq/server/lib/supabase/server';

const cache = new Map<string, { groupIds: string[]; expiresAt: number }>();
const TTL = 15 * 60 * 1000;

export async function getGroupIds(userId: string, orgId: string | null): Promise<string[]> {
  if (!orgId) return [];

  const key = `${userId}:${orgId}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.groupIds;
  }

  const supabase = await createClient();
  const { data } = await supabase.from('group_members').select('group_id').eq('user_id', userId);

  const groupIds = (data ?? []).map((r) => r.group_id);
  cache.set(key, { groupIds, expiresAt: Date.now() + TTL });
  return groupIds;
}

export function invalidateGroupCache(userId: string, orgId: string | null): void {
  if (orgId) cache.delete(`${userId}:${orgId}`);
}
