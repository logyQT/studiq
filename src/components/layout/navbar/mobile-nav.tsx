'use client';

import type { LucideIcon } from 'lucide-react';
import { GraduationCap, Menu } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { UserMenuHeader, UserMenuItems } from '@/components/layout/user-menu-content';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

interface MobileNavItem {
  labelKey: string;
  href: string;
  icon: LucideIcon;
}

interface MobileNavProps {
  items: MobileNavItem[];
  isActive: (href: string) => boolean;
  isLoggedIn: boolean;
}

export function MobileNav({ items, isActive, isLoggedIn }: MobileNavProps) {
  const t = useTranslations('Navbar');
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button className="p-2 rounded-md hover:bg-accent transition" aria-label={t('mobile_menu')}>
          <Menu className="h-5 w-5" />
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-72 p-0 flex flex-col">
        <SheetHeader className="sr-only">
          <SheetTitle>{t('mobile_menu')}</SheetTitle>
          <SheetDescription>{t('logo')}</SheetDescription>
        </SheetHeader>

        {/* Header */}
        <div className="flex items-center gap-2 p-4 border-b shrink-0">
          <GraduationCap className="h-5 w-5 text-primary" />
          <span className="text-lg font-bold">{t('logo')}</span>
        </div>

        {/* Nav links */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {items.map(({ labelKey, href, icon: Icon }) => (
            <Link
              key={labelKey}
              href={href}
              onClick={() => setOpen(false)}
              className={cn(
                'flex items-center gap-2 px-3 py-3 rounded-md text-sm font-medium transition',
                isActive(href)
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
              )}
            >
              <Icon className="h-4 w-4" />
              {t(labelKey)}
            </Link>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t p-4 shrink-0">
          {isLoggedIn ? (
            <div className="space-y-1">
              <UserMenuHeader />
              <div className="h-px bg-border my-2" />
              <UserMenuItems onItemClick={() => setOpen(false)} />
            </div>
          ) : (
            <div className="space-y-2">
              <Button variant="outline" className="w-full" asChild>
                <Link href="/login" onClick={() => setOpen(false)}>
                  {t('login')}
                </Link>
              </Button>
              <Button className="w-full" asChild>
                <Link href="/register" onClick={() => setOpen(false)}>
                  {t('register')}
                </Link>
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
