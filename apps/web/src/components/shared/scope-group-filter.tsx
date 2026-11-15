'use client';

import { MultiSelect } from '@studiq/ui';
import type { useTranslations } from 'next-intl';
import type { GroupOption } from '@/hooks/use-group-options';

interface ScopeGroupFilterProps {
  owner: string;
  onOwnerChange: (value: string) => void;
  groupIds: string[];
  onGroupIdsChange: (value: string[]) => void;
  options: GroupOption[];
  /** The caller's own groups: the "Grupy" row applies them all at once. */
  myGroupIds: string[];
  /** One list-specific filter row, e.g. the deck "show suspended" toggle. */
  extra?: { label: string; checked: boolean; onToggle: () => void };
  t: ReturnType<typeof useTranslations>;
}

/** Value-space sentinels, so the filters live in the group multi-select's own list. */
const ALL = '__all__';
const MINE = '__mine__';
const ALL_GROUPS = '__all_groups__';
const EXTRA = '__extra__';

/**
 * The content-list filters shared by decks, question banks and topics (#595).
 *
 * One multi-select holds every filter dimension — the search box, chips and
 * keyboard handling come from `MultiSelect` — so the toolbar stays short and
 * several filters can be on at once: `Moje` plus a group is the teacher case
 * (my content shared to those groups). `Wszystkie` is the default state, not a
 * constraint. `Grupy` is an action row: it ticks every group the caller is in.
 */
export function ScopeGroupFilter({
  owner,
  onOwnerChange,
  groupIds,
  onGroupIdsChange,
  options,
  myGroupIds,
  extra,
  t,
}: ScopeGroupFilterProps) {
  const mineActive = owner === 'mine';
  const allMineSelected =
    myGroupIds.length > 0 &&
    groupIds.length === myGroupIds.length &&
    myGroupIds.every((id) => groupIds.includes(id));
  const nothingSelected = !mineActive && groupIds.length === 0;

  const items = [
    { value: ALL, label: t('owner_all') },
    { value: MINE, label: t('owner_mine') },
    ...(myGroupIds.length > 0 ? [{ value: ALL_GROUPS, label: t('group_filter') }] : []),
    ...(extra ? [{ value: EXTRA, label: extra.label }] : []),
    ...options.map((group) => ({ value: group.id, label: group.name })),
  ];

  const selected = [...(nothingSelected ? [ALL] : []), ...(mineActive ? [MINE] : []), ...groupIds];

  const handleChange = (next: string[]) => {
    // A list-specific row owns its own state; the click is forwarded to the screen.
    if (extra && next.includes(EXTRA) !== extra.checked) {
      extra.onToggle();
      return;
    }

    // "Grupy" is an action, not a state: it ticks (or clears) the caller's groups.
    if (next.includes(ALL_GROUPS)) {
      onGroupIdsChange(allMineSelected ? [] : myGroupIds);
      return;
    }

    const values = next.filter((value) => value !== ALL && value !== EXTRA);
    if (values.length === 0) {
      onOwnerChange('all');
      onGroupIdsChange([]);
      return;
    }

    onOwnerChange(values.includes(MINE) ? 'mine' : 'all');
    onGroupIdsChange(values.filter((value) => value !== MINE));
  };

  return (
    <MultiSelect
      className="w-56"
      options={items}
      selected={selected}
      onChange={handleChange}
      placeholder={t('owner_all')}
    />
  );
}
