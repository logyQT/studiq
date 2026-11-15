'use client';

import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@studiq/ui';
import { Check, ChevronDown } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { GroupOption } from '@/hooks/use-group-options';
import { cn } from '@/lib/utils';

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

function FilterItem({
  label,
  checked,
  onSelect,
  onHover,
  indent,
}: {
  label: string;
  checked: boolean;
  onSelect: () => void;
  onHover?: () => void;
  indent?: boolean;
}) {
  return (
    <CommandItem
      value={label}
      onSelect={onSelect}
      onMouseEnter={onHover}
      onFocus={onHover}
      className={cn('gap-2', indent && 'pl-7')}
    >
      <Check className={cn('h-4 w-4 shrink-0', checked ? 'opacity-100' : 'opacity-0')} />
      <span className="truncate">{label}</span>
    </CommandItem>
  );
}

/**
 * The content-list filters shared by decks, question banks and topics (#595).
 *
 * One control for every filter dimension: `Moje` (owner), `Grupy` and any
 * list-specific row. Nothing selected is the default, so the trigger shows a
 * plain label instead of a chip that stands for "no filter". Individual groups
 * live under `Grupy`, revealed on hover (or focus, or once you type to search),
 * so they do not clutter the list.
 *
 * Filters are independent: `Moje` plus a group is the teacher case — my content
 * shared to those groups.
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
  const [open, setOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [search, setSearch] = useState('');

  const mineActive = owner === 'mine';
  const allMineSelected =
    myGroupIds.length > 0 &&
    groupIds.length === myGroupIds.length &&
    myGroupIds.every((id) => groupIds.includes(id));

  const toggleGroup = (id: string) => {
    onGroupIdsChange(
      groupIds.includes(id) ? groupIds.filter((group) => group !== id) : [...groupIds, id],
    );
  };

  // The trigger names what is actually filtered; the default says nothing.
  const chips = [
    ...(mineActive ? [t('owner_mine')] : []),
    ...(allMineSelected
      ? [t('group_filter')]
      : options.filter((option) => groupIds.includes(option.id)).map((option) => option.name)),
    ...(extra?.checked ? [extra.label] : []),
  ];

  // Typing searches the groups too, so the sub-list cannot hide the match.
  const showGroups = options.length > 0 && (groupsOpen || search.trim().length > 0);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setGroupsOpen(false);
          setSearch('');
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-72 gap-1.5">
          {chips.length === 0 ? (
            <span className="text-muted-foreground">{t('filter_label')}</span>
          ) : (
            <span className="truncate">{chips.join(' · ')}</span>
          )}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command shouldFilter>
          <CommandInput value={search} onValueChange={setSearch} placeholder={t('filter_search')} />
          <CommandList>
            <CommandEmpty>{t('filter_empty')}</CommandEmpty>
            <CommandGroup>
              <FilterItem
                label={t('owner_mine')}
                checked={mineActive}
                onSelect={() => onOwnerChange(mineActive ? 'all' : 'mine')}
              />

              {options.length > 0 && (
                <FilterItem
                  label={t('group_filter')}
                  checked={allMineSelected}
                  onSelect={() => onGroupIdsChange(allMineSelected ? [] : myGroupIds)}
                  onHover={() => setGroupsOpen(true)}
                />
              )}
              {showGroups &&
                options.map((group) => (
                  <FilterItem
                    key={group.id}
                    label={group.name}
                    checked={groupIds.includes(group.id)}
                    onSelect={() => toggleGroup(group.id)}
                    indent
                  />
                ))}

              {extra && (
                <FilterItem label={extra.label} checked={extra.checked} onSelect={extra.onToggle} />
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
