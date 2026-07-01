'use client';

import {
  BarChart3,
  BookOpen,
  CreditCard,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Sparkles,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useAuth } from '@/components/providers';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UserAvatar } from '@/components/ui/user-avatar';
import { UserRole } from '@/types';
import { DesktopNav } from './navbar/desktop-nav';
import { MobileNav } from './navbar/mobile-nav';
import type { NavLink } from './navbar/types';
import { UserMenuHeader, UserMenuItems } from './user-menu-content';

const studentLinks: NavLink[] = [
  { labelKey: 'nav_overview', href: '/app', icon: LayoutDashboard },
  { labelKey: 'nav_decks', href: '/app/flashcards/decks', icon: BookOpen },
  { labelKey: 'nav_my_questions', href: '/app/my-questions', icon: FileText },
  { labelKey: 'nav_stats', href: '/app/stats/content', icon: BarChart3 },
];

const teacherLinks: NavLink[] = [
  { labelKey: 'nav_overview', href: '/edu', icon: LayoutDashboard },
  { labelKey: 'nav_flashcards', href: '/edu/flashcards/decks', icon: BookOpen },
  { labelKey: 'nav_questions', href: '/edu/questions', icon: FileText },
  { labelKey: 'nav_classroom', href: '/edu/classroom/members', icon: Users },
  { labelKey: 'nav_stats', href: '/edu/stats/data', icon: BarChart3 },
];

const adminLinks: NavLink[] = [
  { labelKey: 'nav_overview', href: '/manage', icon: LayoutDashboard },
  { labelKey: 'nav_members', href: '/manage/members', icon: Users },
  { labelKey: 'nav_settings', href: '/manage/settings', icon: Sparkles },
];

const sysAdminLinks: NavLink[] = [
  { labelKey: 'nav_overview', href: '/admin', icon: LayoutDashboard },
];

const publicLinks = [
  { name: 'features', href: '/features', icon: Sparkles },
  { name: 'pricing', href: '/pricing', icon: CreditCard },
];

export function Navbar() {
  const t = useTranslations('Navbar');
  const { user, isLoading } = useAuth();
  const pathname = usePathname();
  const [avatarOpen, setAvatarOpen] = useState(false);

  const userRole = user?.app_metadata?.role as UserRole | undefined;

  const navLinks: NavLink[] = (() => {
    switch (userRole) {
      case UserRole.TEACHER:
        return teacherLinks;
      case UserRole.UNIVERSITY_ADMIN:
        return adminLinks;
      case UserRole.SYS_ADMIN:
        return sysAdminLinks;
      default:
        return studentLinks;
    }
  })();

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const extraLinks = publicLinks.map((l) => ({ labelKey: l.name, href: l.href, icon: l.icon }));
  const allLinks = user ? [...extraLinks, ...navLinks] : [];

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/70 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* LEFT */}
          <div className="flex items-center min-w-0">
            <Link
              href="/"
              className="flex items-center gap-2 text-xl font-bold tracking-tight hover:opacity-80 transition shrink-0"
            >
              <GraduationCap className="h-6 w-6 text-primary" />
              {t('logo')}
            </Link>

            {/* Mobile nav */}
            <div className="lg:hidden ml-4">
              <MobileNav items={allLinks} isActive={isActive} isLoggedIn={!!user} />
            </div>

            {/* Desktop nav */}
            <div className="hidden lg:flex items-center ml-8 flex-1 min-w-0">
              {user ? (
                <DesktopNav links={allLinks} isActive={isActive} />
              ) : (
                <nav className="flex items-center gap-1">
                  {publicLinks.map(({ name, href, icon: Icon }) => (
                    <Link
                      key={name}
                      href={href}
                      className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition"
                    >
                      <Icon className="h-4 w-4" />
                      {t(name)}
                    </Link>
                  ))}
                </nav>
              )}
            </div>
          </div>

          {/* RIGHT — desktop only */}
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            {isLoading ? null : user ? (
              <DropdownMenu open={avatarOpen} onOpenChange={setAvatarOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="rounded-full transition hover:scale-105 active:scale-95"
                  >
                    <UserAvatar name={user.user_metadata?.name} email={user.email} size={36} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <UserMenuHeader />
                  <DropdownMenuSeparator />
                  <UserMenuItems onItemClick={() => setAvatarOpen(false)} />
                </DropdownMenuContent>
              </DropdownMenu>
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
    </header>
  );
}
