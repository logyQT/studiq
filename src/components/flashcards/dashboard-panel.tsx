'use client';

import Link from 'next/link';
import { LucideIcon } from 'lucide-react';

interface DashboardPanelProps {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  count?: number;
  countLabel?: string;
  gradient: string;
}

export function DashboardPanel({ icon: Icon, title, description, href, count, countLabel, gradient }: DashboardPanelProps) {
  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-xl border bg-card flex flex-col transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:border-primary/50"
    >
      <div className={`h-24 bg-gradient-to-br ${gradient} flex items-center justify-center`}>
        <Icon className="h-10 w-10 text-white/90 transition-transform duration-200 group-hover:scale-110" />
      </div>
      <div className="p-5 flex flex-col flex-1">
        <div>
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
        {count !== undefined && (
          <p className="text-xs text-muted-foreground mt-auto pt-3">{countLabel}</p>
        )}
      </div>
    </Link>
  );
}
