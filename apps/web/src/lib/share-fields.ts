/** The share fields a content form edits: who the item is visible to, and to which groups. */
export interface ShareFields {
  visibility?: 'personal' | 'group';
  groupIds?: string[];
}

/** What a content form dialog hands to its screen to save. */
export interface ContentFormValues extends ShareFields {
  name: string;
  description: string;
}

function normalised(fields: ShareFields): Required<ShareFields> {
  const visibility = fields.visibility ?? 'personal';
  return {
    visibility,
    // A personal item holds no links, so a stale selection must never travel with it.
    groupIds: visibility === 'group' ? [...new Set(fields.groupIds ?? [])].toSorted() : [],
  };
}

/**
 * The body a content form submits, built from the delta against the stored row.
 *
 * `visibility`/`groupIds` are omitted when the share selection did not change: a sent `groupIds`
 * runs the group-teacher check (`canShareContentToGroups`), so re-saving an unchanged share set
 * made a name edit answer 403 for an org Admin who holds `deck.update` at organization but does
 * not teach the deck's group (#1555). The server reads an omitted field as "keep". A new item has
 * no stored row, so its body always carries the selection.
 */
export function contentFormPayload(
  stored: ShareFields | null | undefined,
  next: ContentFormValues,
): ContentFormValues {
  const { name, description, visibility, groupIds } = next;
  if (!stored) return { name, description, ...normalised({ visibility, groupIds }) };

  const before = normalised(stored);
  const after = normalised({ visibility, groupIds });
  const unchanged =
    after.visibility === before.visibility &&
    after.groupIds.length === before.groupIds.length &&
    after.groupIds.every((id, index) => id === before.groupIds[index]);

  return unchanged ? { name, description } : { name, description, ...after };
}
