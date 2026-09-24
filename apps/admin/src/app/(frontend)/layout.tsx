'use client';

import { Button, cn } from '@studiq/ui';
import {
  Building2,
  CreditCard,
  Flag,
  LayoutDashboard,
  LogOut,
  Settings,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

const NAV_ITEMS = [
  { key: 'admin_overview', href: '/', icon: LayoutDashboard },
  { key: 'admin_feature_flags', href: '/feature-flags', icon: Flag },
  { key: 'admin_subscription_plans', href: '/subscription-plans', icon: CreditCard },
  { key: 'admin_user_overrides', href: '/user-overrides', icon: Users },
  { key: 'admin_orgs', href: '/orgs', icon: Building2 },
  { key: 'admin_settings', href: '/settings', icon: Settings },
] as const;

export default function FrontendLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('DashboardLayout');
  const pathname = usePathname();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
      router.refresh();
    }
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 shrink-0 border-r bg-card flex flex-col">
        <div className="p-6">
          <h2 className="text-lg font-semibold tracking-tight">{t('sys_admin_dashboard')}</h2>
          <p className="text-xs text-muted-foreground mt-1">{t('role_sys_admin')}</p>
        </div>
        <nav className="px-3 pb-4 flex-1">
          <ul className="space-y-1">
            {NAV_ITEMS.map(({ key, href, icon: Icon }) => {
              const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
              return (
                <li key={key}>
                  <Link
                    href={href}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {t(key)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="px-3 pb-4">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 px-3 text-muted-foreground hover:text-destructive"
            onClick={handleLogout}
            disabled={isLoggingOut}
          >
            <LogOut className="h-4 w-4" />
            {t('logout')}
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
