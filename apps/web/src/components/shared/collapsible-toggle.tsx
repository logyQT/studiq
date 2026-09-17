'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface CollapsibleToggleProps {
  open: boolean;
  onToggle: () => void;
  icon?: ReactNode;
  label: ReactNode;
  badge?: ReactNode;
  compact?: boolean;
}

export function CollapsibleToggle({
  open,
  onToggle,
  icon,
  label,
  badge,
  compact,
}: CollapsibleToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'flex w-full items-center gap-1.5 px-3 text-left text-muted-foreground hover:text-foreground transition-colors',
        compact ? 'py-1.5' : 'py-2',
      )}
    >
      {open ? (
        <ChevronDown className="h-3 w-3 shrink-0" />
      ) : (
        <ChevronRight className="h-3 w-3 shrink-0" />
      )}
      {icon}
      <span className="font-medium">{label}</span>
      {badge && <span className="ml-auto">{badge}</span>}
    </button>
  );
}
