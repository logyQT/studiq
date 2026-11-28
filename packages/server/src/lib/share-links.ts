/** The `*_groups` rows a content update must end with. */
export interface ShareLinkUpdate {
  /** `null` = leave the stored links alone; `[]` = delete them. */
  groupIds: string[] | null;
  /** The resulting row would be `group`-visible with no links at all. */
  groupWithoutLinks: boolean;
}

/**
 * Derives the group links of a topic or deck update from the RESULTING visibility, so a
 * partial body cannot leave the row and its `*_groups` table disagreeing:
 *
 * - effective `personal` → the links go, whether or not `groupIds` was sent (a share must
 *   not survive the switch to `personal`);
 * - `group` with a sent list → that list replaces the stored one;
 * - `group` with nothing sent → the stored links stay, but only when the row already was
 *   group-visible. Otherwise the update is invalid, because it would produce "group with
 *   zero links". Topics can reach that state on create: `POST /api/v1/topics` without
 *   `visibility` and `bulkCreate` both store `group` with no links. The state is harmless,
 *   because no links means creator-only access. Unsharing a stored row has to go through
 *   `visibility: 'personal'`, so the 422 applies to an update only.
 */
export function planShareLinks(input: {
  sentVisibility?: 'personal' | 'group';
  sentGroupIds?: string[];
  storedVisibility: string;
}): ShareLinkUpdate {
  const { sentVisibility, sentGroupIds, storedVisibility } = input;
  const effectiveVisibility = sentVisibility ?? storedVisibility;
  const linksTouched = sentVisibility !== undefined || sentGroupIds !== undefined;

  const groupIds = !linksTouched
    ? null
    : effectiveVisibility !== 'group'
      ? []
      : sentGroupIds !== undefined
        ? [...new Set(sentGroupIds)]
        : null;

  const groupWithoutLinks =
    effectiveVisibility === 'group' &&
    (groupIds !== null ? groupIds.length === 0 : storedVisibility !== 'group');

  return { groupIds, groupWithoutLinks };
}
