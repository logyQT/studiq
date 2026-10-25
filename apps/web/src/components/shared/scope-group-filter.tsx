'use client';

import {
  Button,
  MultiSelect,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@studiq/ui';
import type { useTranslations } from 'next-intl';
import type { GroupOption } from '@/hooks/use-group-options';

interface ScopeGroupFilterProps {
  owner: string;
  onOwnerChange: (value: string) => void;
  groupIds: string[];
  onGroupIdsChange: (value: string[]) => void;
  options: GroupOption[];
  myGroupIds: string[];
  t: ReturnType<typeof useTranslations>;
}

/**
 * The content-list filter controls shared by decks, question banks and topics (#595):
 * one scope select (`Wszystkie | Moje`) plus a group multi-select with a "My groups"
 * quick action. Rendered in one place so the three screens cannot drift again.
 */
export function ScopeGroupFilter({
  owner,
  onOwnerChange,
  groupIds,
  onGroupIdsChange,
  options,
  myGroupIds,
  t,
}: ScopeGroupFilterProps) {
  const mineSelected =
    myGroupIds.length > 0 &&
    groupIds.length === myGroupIds.length &&
    myGroupIds.every((id) => groupIds.includes(id));

  return (
    <>
      <Select value={owner} onValueChange={onOwnerChange}>
        <SelectTrigger className="w-35 truncate">
          <SelectValue placeholder={t('owner_all')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('owner_all')}</SelectItem>
          <SelectItem value="mine">{t('owner_mine')}</SelectItem>
        </SelectContent>
      </Select>
      {options.length > 0 && (
        <div className="flex items-center gap-1.5">
          <MultiSelect
            className="w-52"
            options={options.map((group) => ({ label: group.name, value: group.id }))}
            selected={groupIds}
            onChange={onGroupIdsChange}
            placeholder={t('group_filter_any')}
          />
          {myGroupIds.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              disabled={mineSelected}
              onClick={() => onGroupIdsChange(myGroupIds)}
            >
              {t('group_filter_mine')}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
