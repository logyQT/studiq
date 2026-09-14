'use client';

import { Search, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Input } from '@/components/ui/input';

interface PageToolbarProps {
  search: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  };
  children?: ReactNode;
  actions?: ReactNode;
}

export function PageToolbar({ search, children, actions }: PageToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 max-sm:hidden">
      <div className="relative flex-1 basis-full lg:basis-auto lg:max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search.value}
          onChange={(e) => search.onChange(e.target.value)}
          placeholder={search.placeholder}
          className="pl-9 pr-9"
        />
        {search.value && (
          <button
            onClick={() => search.onChange('')}
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
