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
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
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
 * panel renders beside it, so it is a plain button — which is also what gives it
 * a real focus target for the keyboard.
 */
function SideItem({
  label,
  checked,
  onSelect,
  onKeyDown,
}: {
  label: string;
  checked: boolean;
  onSelect: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      data-group-option=""
      aria-pressed={checked}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden focus-visible:ring-inset"
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
 * on hover, or with ArrowRight from the „Grupy” row; Escape and ArrowLeft bring
 * the focus back to the list. A typed query lists the matching groups as ordinary
 * rows instead of force-opening the panel: filtering the list can hide the row the
 * panel is anchored to, and a panel anchored to a hidden row is placed nowhere.
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
  /** The group panel, opened by the pointer or by the keyboard. */
  const [panelOpen, setPanelOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const groupRowRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLFieldSetElement>(null);
  /** Whether the panel was opened by the keyboard and so owes the first row focus. */
  const focusFirstGroup = useRef(false);

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

  const query = search.trim().toLowerCase();
  const matchingGroups = query
    ? options.filter((group) => group.name.toLowerCase().includes(query))
    : options;

  useEffect(() => {
    if (!panelOpen || !focusFirstGroup.current) return undefined;
    focusFirstGroup.current = false;
    // The panel is portalled and placed by Radix after the commit, so the focus
    // move waits one frame — the effect itself can still see an empty portal.
    const frame = requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLButtonElement>('[data-group-option]')?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [panelOpen]);

  /** Closes the panel and hands the keyboard back to the command list. */
  const closePanel = () => {
    setPanelOpen(false);
    focusFirstGroup.current = false;
    containerRef.current?.querySelector<HTMLInputElement>('[cmdk-input]')?.focus();
  };

  /**
   * The „Grupy” row is not a DOM focus target — cmdk keeps focus in the search
   * input and marks the row with `aria-selected` — so ArrowRight enters the panel
   * from there. cmdk leaves the horizontal arrows untouched.
   */
  const handleCommandKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' || query) return;
    const selected = containerRef.current?.querySelector('[cmdk-item][aria-selected="true"]');
    if (!selected || !groupRowRef.current?.contains(selected)) return;
    event.preventDefault();
    focusFirstGroup.current = true;
    setPanelOpen(true);
  };

  const handlePanelKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    // The panel is portalled but still sits in the command's React tree, so an
    // unclaimed key would also reach cmdk and select the row behind the panel.
    if (event.key === 'Enter' || event.key === ' ') {
      event.stopPropagation();
      return;
    }
    if (event.key === 'Escape' || event.key === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
      closePanel();
      return;
    }
    if (event.key !== 'Tab' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    const buttons = Array.from(
      panelRef.current?.querySelectorAll<HTMLButtonElement>('[data-group-option]') ?? [],
    );
    const currentIndex = buttons.indexOf(event.currentTarget);
    if (currentIndex < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey) ? -1 : 1;
    buttons[(currentIndex + step + buttons.length) % buttons.length]?.focus();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setPanelOpen(false);
        focusFirstGroup.current = false;
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
        <div ref={containerRef}>
          <Command shouldFilter onKeyDown={handleCommandKeyDown}>
            <CommandInput
              value={search}
              onValueChange={(value) => {
                setSearch(value);
                // A typed query swaps the panel for inline rows; a stale open panel
                // would come back as soon as the query is cleared.
                if (value) setPanelOpen(false);
              }}
              placeholder={t('filter_search')}
            />
            <CommandList>
              <CommandEmpty>{t('filter_empty')}</CommandEmpty>
              <CommandGroup className="p-0">
                <FilterItem
                  label={t('owner_mine')}
                  checked={mineActive}
                  onSelect={() => onOwnerChange(mineActive ? 'all' : 'mine')}
                />

                {options.length > 0 && !query && (
                  <HoverCard
                    open={panelOpen}
                    onOpenChange={setPanelOpen}
                    openDelay={100}
                    closeDelay={150}
                  >
                    {/* The span is the anchor: `CommandItem` renders a div without a
                        ref, which Radix needs to place the panel beside the row. */}
                    <HoverCardTrigger asChild>
                      <span ref={groupRowRef} className="block">
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
                      <fieldset
                        ref={panelRef}
                        aria-label={t('group_filter')}
                        className="m-0 min-w-0 border-0 p-0"
                      >
                        {options.map((group) => (
                          <SideItem
                            key={group.id}
                            label={group.name}
                            checked={groupIds.includes(group.id)}
                            onSelect={() => toggleGroup(group.id)}
                            onKeyDown={handlePanelKeyDown}
                          />
                        ))}
                      </fieldset>
                    </HoverCardContent>
                  </HoverCard>
                )}

                {extra && (
                  <FilterItem
                    label={extra.label}
                    checked={extra.checked}
                    onSelect={extra.onToggle}
                  />
                )}
              </CommandGroup>

              {/* A query lists the matches as ordinary rows: the „Grupy” row it would
                  anchor a panel to is the first thing cmdk filters out. */}
              {query && matchingGroups.length > 0 && (
                <CommandGroup heading={t('group_filter')} className="p-0">
                  {matchingGroups.map((group) => (
                    <FilterItem
                      key={group.id}
                      label={group.name}
                      checked={groupIds.includes(group.id)}
                      onSelect={() => toggleGroup(group.id)}
                    />
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </div>
      </PopoverContent>
    </Popover>
  );
}
