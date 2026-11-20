'use client';

import { useMemo } from 'react';
import { useApiQuery } from '@/hooks/use-api';
import { usePermission } from '@/hooks/use-permission';
import { useOrgs } from '@/hooks/use-orgs';
import { groupKeys } from '@/lib/query-keys';

export interface GroupOption {
  id: string;
  name: string;
}

/**
 * Shared source for the content-list group filter (#595): the caller's groups in the
 * active org plus every group they may manage, deduped by id.
 *
 * Uses the same query keys as the create/edit dialogs, so the screens add no extra
 * requests and no cache churn.
 */
export function useGroupOptions() {
  const { activeOrg } = useOrgs();
  // The org-wide list is for a class MANAGER: it exists so a teacher can filter by
  // a class they may edit, not to widen a student's picker. `group.read` alone is
  // not that gate — every student holds it at `group` scope — so the list is asked
  // for only when one of the two write keys is in the map. `/me/groups` below
  // always supplies the caller's own classes.
  const permission = usePermission();
  const managesGroups = permission('group.manage') || permission('group.member.manage');

  const groupsQuery = useApiQuery<GroupOption[]>({
    queryKey: groupKeys.list(activeOrg?.id),
    url: '/api/v1/organization/groups',
    enabled: !!activeOrg?.id && managesGroups,
  });
  const myGroupsQuery = useApiQuery<Array<GroupOption & { organizationId: string }>>({
    queryKey: groupKeys.my,
    url: '/api/v1/me/groups',
  });

  const groupsData = groupsQuery.data;
  const myGroupsInOrg = useMemo(
    () => (myGroupsQuery.data ?? []).filter((g) => g.organizationId === activeOrg?.id),
    [myGroupsQuery.data, activeOrg?.id],
  );

  const options = useMemo(() => {
    const byId = new Map<string, GroupOption>();
    for (const group of [...myGroupsInOrg, ...(groupsData ?? [])]) {
      byId.set(group.id, { id: group.id, name: group.name });
    }
    return [...byId.values()];
  }, [myGroupsInOrg, groupsData]);

  const myGroupIds = useMemo(() => myGroupsInOrg.map((g) => g.id), [myGroupsInOrg]);
  const groupNameMap = useMemo(
    () => new Map(options.map((g) => [g.id, g.name] as const)),
    [options],
  );
  // An org-scoped group list only loads with an org; without one the selection is empty anyway.
  const ready =
    myGroupsQuery.isFetched && (!managesGroups || !activeOrg?.id || groupsQuery.isFetched);

  return { groupsData, options, myGroupIds, groupNameMap, ready };
}
