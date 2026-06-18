'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/components/providers';
import { UserRole } from '@/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from './ThemeToggle';
import { LanguageToggle } from './LanguageToggle';
import { DicebearAvatar } from '@/components/ui/dicebear-avatar';
import { Menu, X, LayoutDashboard, GraduationCap, Sparkles, CreditCard } from 'lucide-react';
import { toast } from 'sonner';

const ROLE_DASHBOARD: Record<UserRole, string> = {
  [UserRole.SYS_ADMIN]: '/admin',
  [UserRole.UNIVERSITY_ADMIN]: '/manage',
  [UserRole.TEACHER]: '/edu',
  [UserRole.STUDENT]: '/app',
  [UserRole.PREMIUM]: '/app',
  [UserRole.FREE]: '/app',
};

export function Navbar() {
  const t = useTranslations('Navbar');
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);

  const userRole = user?.app_metadata?.role as UserRole | undefined;
  const dashboardHref = userRole ? ROLE_DASHBOARD[userRole] : '/';

  const publicLinks = [
    { name: 'features', href: '/features', icon: Sparkles },
    { name: 'pricing', href: '/pricing', icon: CreditCard },
  ];

  const handleLogout = async () => {
    try {
      const res = await fetch('/api/v1/auth/logout', { method: 'POST' });
      if (!res.ok) throw new Error('logout_failed');
      router.replace('/login');
      toast.success(t('LOGOUT_SUCCESS'));
    } catch {
      toast.error(t('LOGOUT_FAILED'));
    }
    setAvatarOpen(false);
  };

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/70 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* LEFT */}
          <div className="flex items-center gap-8">
            {/* LOGO */}
            <Link
              href="/"
              className="flex items-center gap-2 text-xl font-bold tracking-tight hover:opacity-80 transition"
            >
              <GraduationCap className="h-6 w-6 text-primary" />
              {t('logo')}
            </Link>

            {/* DESKTOP NAV */}
            <nav className="hidden lg:flex items-center gap-1">
              {user ? (
                <Link
                  href={dashboardHref}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition',
                    isActive(dashboardHref)
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                  )}
                >
                  <LayoutDashboard className="h-4 w-4" />
                  {t('dashboard')}
                </Link>
              ) : (
                publicLinks.map(({ name, href, icon: Icon }) => (
                  <Link
                    key={name}
                    href={href}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition',
                      isActive(href)
                        ? 'bg-accent text-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {t(name)}
                  </Link>
                ))
              )}
            </nav>
          </div>

          {/* RIGHT */}
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle />

            {/* MOBILE HAMBURGER */}
            <button
              className="lg:hidden p-2 rounded-md hover:bg-accent transition"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>

            {/* AUTH */}
            <div className="hidden sm:block ml-2">
              {isLoading ? null : user ? (
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setAvatarOpen((prev) => !prev);
                    }}
                    className="rounded-full transition hover:scale-105 active:scale-95"
                  >
                    <DicebearAvatar seed={user.email} size={36} />
                  </button>

                  {avatarOpen && (
                    <div className="absolute right-0 mt-3 w-64 rounded-xl border bg-background/95 backdrop-blur-xl shadow-xl p-4 z-50 animate-in fade-in zoom-in-95">
                      <div className="flex items-center gap-3 mb-3">
                        <DicebearAvatar seed={user.email} size={36} />
                        <div className="flex flex-col leading-tight">
                          <span className="font-semibold text-sm">
                            {user.user_metadata.name || t('default_user')}
                          </span>
                          <p className="text-xs text-muted-foreground truncate max-w-[160px]">
                            {user.email}
                          </p>
                        </div>
                      </div>

                      <div className="h-px bg-border my-2" />

                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start text-sm"
                        onClick={handleLogout}
                      >
                        {t('logout')}
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/login">{t('login')}</Link>
                  </Button>
                  <Button size="sm" asChild>
                    <Link href="/register">{t('register')}</Link>
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* MOBILE DRAWER */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="fixed inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="fixed right-0 top-0 h-full w-72 bg-background border-l shadow-xl animate-in slide-in-from-right">
            <div className="flex items-center justify-between p-4 border-b">
              <div className="flex items-center gap-2">
                <GraduationCap className="h-5 w-5 text-primary" />
                <span className="text-lg font-bold">{t('logo')}</span>
              </div>
              <button onClick={() => setMobileOpen(false)} className="p-1 hover:bg-accent rounded">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="p-4 space-y-1">
              {user ? (
                <Link
                  href={dashboardHref}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-3 rounded-md text-sm font-medium transition',
                    isActive(dashboardHref)
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                  )}
                >
                  <LayoutDashboard className="h-4 w-4" />
                  {t('dashboard')}
                </Link>
              ) : (
                publicLinks.map(({ name, href, icon: Icon }) => (
                  <Link
                    key={name}
                    href={href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-3 rounded-md text-sm font-medium transition',
                      isActive(href)
                        ? 'bg-accent text-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {t(name)}
                  </Link>
                ))
              )}

              <div className="h-px bg-border my-4" />

              {user ? (
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => {
                    setMobileOpen(false);
                    handleLogout();
                  }}
                >
                  {t('logout')}
                </Button>
              ) : (
                <div className="space-y-2">
                  <Button variant="outline" className="w-full" asChild>
                    <Link href="/login" onClick={() => setMobileOpen(false)}>
                      {t('login')}
                    </Link>
                  </Button>
                  <Button className="w-full" asChild>
                    <Link href="/register" onClick={() => setMobileOpen(false)}>
                      {t('register')}
                    </Link>
                  </Button>
                </div>
              )}
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}
