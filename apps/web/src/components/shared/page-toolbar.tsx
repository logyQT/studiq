'use client';

import { Input } from '@studiq/ui';
import { Search, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageToolbarProps {
  search: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    ariaLabel?: string;
    clearLabel?: string;
  };
  children?: ReactNode;
  actions?: ReactNode;
  /** Keep the toolbar visible on small screens (inbox filters are the only navigation there). */
  alwaysVisible?: boolean;
}

export function PageToolbar({ search, children, actions, alwaysVisible }: PageToolbarProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3', !alwaysVisible && 'max-sm:hidden')}>
      <div className="relative flex-1 basis-full lg:basis-auto lg:max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search.value}
          onChange={(e) => search.onChange(e.target.value)}
          placeholder={search.placeholder}
          aria-label={search.ariaLabel}
          className="pl-9 pr-9"
        />
        {search.value && (
          <button
            onClick={() => search.onChange('')}
            aria-label={search.clearLabel}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {children}
      {actions && <div className="flex items-center gap-2 sm:ml-auto">{actions}</div>}
    </div>
  );
}
