'use client';

import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
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
  /** One list-specific filter row, e.g. the deck "Zawieszone" toggle. */
  extra?: { label: string; checked: boolean; onToggle: () => void };
  t: ReturnType<typeof useTranslations>;
}

/** A filter dimension row, inside the searchable command list. */
function FilterItem({
  label,
  checked,
  onSelect,
}: {
  label: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <CommandItem
      value={label}
      onSelect={onSelect}
      // cmdk owns `role="option"` and `aria-selected` (which follows the keyboard
      // highlight, not the filter), so the filter's own state rides on `aria-checked`.
      aria-checked={checked}
      className="rounded-none px-3 py-2"
    >
      <Check className={cn('h-4 w-4 shrink-0', checked ? 'opacity-100' : 'opacity-0')} />
      <span className="truncate">{label}</span>
    </CommandItem>
  );
}

/**
 * A row in the side panel. `CommandItem` needs the `Command` context and this
 * panel renders beside it, so it is a plain button.
 */
function SideItem({
  label,
  checked,
  onSelect,
}: {
  label: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={onSelect}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
    >
      <Check className={cn('h-4 w-4 shrink-0', checked ? 'opacity-100' : 'opacity-0')} />
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * The content-list filters shared by decks, question banks and topics (#595).
 *
 * One control for every filter dimension: `Moje` (owner), `Grupy` and any
 * list-specific row. Nothing selected is the default, so the trigger shows a
 * plain label instead of a chip that stands for "no filter". The groups open in
 * a panel beside the list — revealing them never pushes the other rows down —
 * on hover, on focus, or while searching.
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

  // Typing searches the groups too, so the flyout cannot hide the match. Hover is
  // Radix's own (an uncontrolled open): driving it from state re-rendered the row
  // under the pointer and detached it mid-click.
  const query = search.trim().toLowerCase();
  const visibleGroups = query
    ? options.filter((group) => group.name.toLowerCase().includes(query))
    : options;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch('');
      }}
    >
      <PopoverTrigger asChild>
        {/* Fixed width so the toolbar does not shift between locales or as filters
            are added; it fits the longest label ("Zawieszone" / "Suspended"). */}
        <Button
          variant="outline"
          size="sm"
          // The chips are the control's value, not its name.
          aria-label={t('filter_label')}
          title={chips.length === 0 ? undefined : chips.join(' · ')}
          className="w-44 justify-between gap-1.5"
        >
          {chips.length === 0 ? (
            <span className="truncate text-muted-foreground">{t('filter_label')}</span>
          ) : (
            <span className="truncate">{chips.join(' · ')}</span>
          )}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>

      {/* `overflow-hidden` keeps the full-bleed row highlight inside the rounded corners. */}
      <PopoverContent align="start" className="w-56 overflow-hidden p-0">
        <Command shouldFilter>
          <CommandInput value={search} onValueChange={setSearch} placeholder={t('filter_search')} />
          <CommandList>
            <CommandEmpty>{t('filter_empty')}</CommandEmpty>
            <CommandGroup className="p-0">
              <FilterItem
                label={t('owner_mine')}
                checked={mineActive}
                onSelect={() => onOwnerChange(mineActive ? 'all' : 'mine')}
              />

              {options.length > 0 && (
                <HoverCard
                  open={query.length > 0 ? true : undefined}
                  openDelay={100}
                  closeDelay={150}
                >
                  {/* The span is the anchor: `CommandItem` renders a div without a
                      ref, which Radix needs to place the panel beside the row. */}
                  <HoverCardTrigger asChild>
                    <span className="block">
                      <FilterItem
                        label={t('group_filter')}
                        checked={allMineSelected}
                        onSelect={() => onGroupIdsChange(allMineSelected ? [] : myGroupIds)}
                      />
                    </span>
                  </HoverCardTrigger>

                  {/* Beside the list, not below it: the rows never reflow, and the
                      panel is portalled so the command list cannot clip it. */}
                  {/* Flush against the list and open on its left edge: the panel
                      reads as the same surface extending, not a detached box. */}
                  <HoverCardContent
                    side="right"
                    align="start"
                    sideOffset={-1}
                    className="max-h-72 w-48 overflow-y-auto rounded-l-none border-l-0 p-0 shadow-none"
                  >
                    {visibleGroups.length === 0 ? (
                      <p className="px-2 py-1.5 text-sm text-muted-foreground">
                        {t('filter_empty')}
                      </p>
                    ) : (
                      visibleGroups.map((group) => (
                        <SideItem
                          key={group.id}
                          label={group.name}
                          checked={groupIds.includes(group.id)}
                          onSelect={() => toggleGroup(group.id)}
                        />
                      ))
                    )}
                  </HoverCardContent>
                </HoverCard>
              )}

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
