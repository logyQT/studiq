/**
 *  @Tonderysik
 *  TODO: Convert navbar to auth-aware UI.
 *  TODO: Show login/register when unauthenticated.
 *  TODO: Use AuthProvider (@/components/providers/AuthProvider) to manage auth state and SSR-safe user data.
 *  TODO: Replace with avatar dropdown (profile, settings, logout) when authenticated.
 *  TODO: Keep consistent sizing, SSR-safe auth handling, and no layout shift.
 *  TODO: Add mobile responsive menu (hamburger) for smaller screens.
 *  TODO: Add active link highlighting based on current route.
 */

'use client';

import Link from 'next/link';
import { LayoutDashboard, BookOpen, Brain, MessageSquare, BarChart3 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from './ThemeToggle';
import { LanguageToggle } from './LanguageToggle';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/components/providers';
import Avatar from 'boring-avatars';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AppError } from '@/lib/errors';
import { useEffect, useState } from 'react';

const NAV_LINKS = [
  { name: 'dashboard', icon: LayoutDashboard, href: '/dashboard' },
  { name: 'quiz', icon: BookOpen, href: '/quiz' },
  { name: 'flashcards', icon: Brain, href: '/flashcards' },
  { name: 'ai_powered_exam', icon: MessageSquare, href: '/ai-powered-exam' },
  { name: 'stat', icon: BarChart3, href: '/statistics' },
];

export function Navbar() {
  const t = useTranslations('Navbar');
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const handleLogout = async () => {
    try {
      const { ok } = await fetch('api/v1/auth/logout', { method: 'POST' });
      if (!ok) throw new AppError('LOGOUT_FAILED');
      router.replace('/login');
      toast.success(t('LOGOUT_SUCCESS'));
    } catch {
      toast.error(t('LOGOUT_FAILED'));
    }
  };

  useEffect(() => {
    const handleClickOutside = () => setOpen(false);
    if (open) {
      window.addEventListener('click', handleClickOutside);
    }
    return () => window.removeEventListener('click', handleClickOutside);
  }, [open]);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/70 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* LEFT */}
          <div className="flex items-center gap-10">
            {/* LOGO */}
            <Link href="/" className="text-xl font-bold tracking-tight hover:opacity-80 transition">
              {t('logo')}
            </Link>

            {/* NAV */}
            <nav className="hidden lg:flex items-center gap-1">
              {NAV_LINKS.map(({ name, icon: Icon, href }) => (
                <Link
                  key={name}
                  href={href}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium',
                    'text-muted-foreground hover:text-foreground hover:bg-accent transition',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {t(name)}
                </Link>
              ))}
            </nav>
          </div>

          {/* RIGHT */}
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle />

            {/* AUTH */}
            <div className="ml-2">
              {isLoading ? null : user ? (
                <div className="relative">
                  {/* AVATAR */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen((prev) => !prev);
                    }}
                    className="rounded-full transition hover:scale-105 active:scale-95"
                  >
                    <Avatar
                      size={36}
                      name={user.email || 'User'}
                      variant="beam"
                      colors={['#444', '#555', '#666', '#777', '#888']}
                    />
                  </button>

                  {/* DROPDOWN */}
                  {open && (
                    <div className="absolute right-0 mt-3 w-64 rounded-xl border bg-background/95 backdrop-blur-xl shadow-xl p-4 z-50 animate-in fade-in zoom-in-95">
                      {/* USER INFO */}
                      <div className="flex items-center gap-3 mb-3">
                        <Avatar
                          size={36}
                          name={user.email || 'User'}
                          variant="beam"
                          colors={['#444', '#555', '#666', '#777', '#888']}
                        />

                        <div className="flex flex-col leading-tight">
                          <span className="font-semibold text-sm">
                            {user.user_metadata.name || 'User'}
                          </span>
                          <p className="text-xs text-muted-foreground truncate max-w-[160px]">
                            {user.email}
                          </p>
                        </div>
                      </div>

                      {/* DIVIDER */}
                      <div className="h-px bg-border my-2" />

                      {/* ACTION */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start text-sm"
                        onClick={handleLogout}
                      >
                        {t('logout') || 'Logout'}
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="hidden sm:flex items-center gap-2">
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
    </header>
  );
}
