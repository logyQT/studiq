import type { LayoutDashboard } from 'lucide-react';

export interface NavLink {
  labelKey: string;
  href: string;
  icon: typeof LayoutDashboard;
}
