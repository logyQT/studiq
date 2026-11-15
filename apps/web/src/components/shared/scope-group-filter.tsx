'use client';

import {
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
  t: ReturnType<typeof useTranslations>;
}

/**
 * The content-list filter controls shared by decks, question banks and topics (#595):
 * one scope select (`Wszystkie | Moje`) plus a group multi-select. Rendered in one
 * place so the three screens cannot drift again.
 */
export function ScopeGroupFilter({
  owner,
  onOwnerChange,
  groupIds,
  onGroupIdsChange,
  options,
  t,
}: ScopeGroupFilterProps) {
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
        <MultiSelect
          className="w-52"
          options={options.map((group) => ({ label: group.name, value: group.id }))}
          selected={groupIds}
          onChange={onGroupIdsChange}
          placeholder={t('group_filter_any')}
        />
      )}
    </>
  );
}
