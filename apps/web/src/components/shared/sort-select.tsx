'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@studiq/ui';
import type { SortOption } from '@/lib/content-sort-options';

interface SortSelectProps {
  sortBy: string;
  sortOrder: string;
  onChange: (sortBy: string, sortOrder: string) => void;
  options: SortOption[];
  triggerClassName?: string;
}

/** The `sortBy:sortOrder` select every content list uses, with its own option list. */
export function SortSelect({
  sortBy,
  sortOrder,
  onChange,
  options,
  triggerClassName = 'w-37.5 truncate',
}: SortSelectProps) {
  return (
    <Select
      value={`${sortBy}:${sortOrder}`}
      onValueChange={(value) => {
        const [nextSortBy, nextSortOrder] = value.split(':');
        if (!nextSortBy || !nextSortOrder) return;
        onChange(nextSortBy, nextSortOrder);
      }}
    >
      <SelectTrigger className={triggerClassName}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
