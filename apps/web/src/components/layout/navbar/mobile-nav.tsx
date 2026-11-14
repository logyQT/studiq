'use client';

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@studiq/ui';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, GraduationCap, Menu, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { UserMenuHeader, UserMenuItems } from '@/components/layout/user-menu-content';
import { LanguageSwitcher } from '@/components/shared/language-switcher/language-switcher';
import { ThemeSwitch } from '@/components/shared/theme-switch/theme-switch';
import { useBranding } from '@/hooks/use-branding';
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

/** Solid 2px ring at a 2px offset — the kit's `ring-ring/50` is 2.45:1 on paper. */
const FOCUS_RING =
  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none';

const ICON_BUTTON = cn(
  'inline-flex size-11 items-center justify-center rounded-control text-foreground transition-colors hover:bg-accent',
  FOCUS_RING,
);

/** `signal` fill / `ink` text: the drawer's one primary action (DESIGN §Dosage). */
const CTA_PRIMARY = cn(
  'inline-flex h-11 items-center justify-center rounded-control bg-signal px-6 text-sm font-semibold text-signal-foreground transition-colors hover:bg-signal/90',
  FOCUS_RING,
);

const CTA_QUIET = cn(
  'inline-flex h-11 items-center justify-center rounded-control border border-input px-6 text-sm font-semibold text-foreground transition-colors hover:bg-secondary',
  FOCUS_RING,
);

export function MobileNav({ items, isActive, isLoggedIn }: MobileNavProps) {
  const t = useTranslations('Navbar');
  const [open, setOpen] = useState(false);
  const { logoUrl } = useBranding();
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button type="button" aria-label={t('mobile_menu')} className={cn('-ml-2', ICON_BUTTON)}>
          <Menu aria-hidden className="size-5" />
        </button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className={cn(
          // The kit panel carries shadow-lg and its own close button (16px, English
          // label); this drawer is flat paper with a hairline edge and a 44px close
          // in the header, so the kit's one is suppressed rather than restyled.
          'flex w-80 max-w-[85vw] flex-col gap-0 border-l border-border bg-background shadow-none',
          '[&>button:last-child]:hidden',
        )}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{t('mobile_menu')}</SheetTitle>
          <SheetDescription>{t('logo')}</SheetDescription>
        </SheetHeader>

        <div className="flex shrink-0 items-center justify-between gap-3 py-2 pr-2 pl-4">
          <span className="flex min-w-0 items-center gap-2">
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt=""
                width={20}
                height={20}
                className="size-5 shrink-0 rounded-control object-contain"
                unoptimized
              />
            ) : (
              <GraduationCap aria-hidden className="size-5 shrink-0 text-primary" />
            )}
            <span className="truncate text-lg font-bold tracking-tight">{t('logo')}</span>
          </span>
          <SheetClose asChild>
            <button type="button" aria-label={t('common_close')} className={ICON_BUTTON}>
              <X aria-hidden className="size-5" />
            </button>
          </SheetClose>
        </div>

        {/*
         * A hairline ledger, not an icon list: the page behind this panel sets
         * destinations the same way (see the feature rows), and the kit's stock
         * glyphs (Sparkles for "Funkcje") are exactly the chrome DESIGN.md retires.
         */}
        <nav aria-label={t('mobile_menu')} className="flex-1 overflow-y-auto">
          <ul className="divide-y divide-input border-y border-border">
            {items.map(({ labelKey, href }) => {
              const active = isActive(href);
              return (
                <li key={labelKey}>
                  <Link
                    href={href}
                    onClick={close}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group flex min-h-12 items-center gap-4 px-4 text-base text-primary transition-colors hover:bg-accent',
                      active && 'bg-accent font-semibold',
                      FOCUS_RING,
                    )}
                  >
                    <span className="flex-1">{t(labelKey)}</span>
                    <ArrowRight
                      aria-hidden
                      className={cn(
                        'size-4 shrink-0 text-primary/60 transition-opacity',
                        active ? 'opacity-100' : 'opacity-60 group-hover:opacity-100',
                      )}
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* On a phone the footer is a long scroll away, so the two preferences
            live here as well. This block is what keeps the panel from reading as
            a menu whose content simply ran out. */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-3">
          <LanguageSwitcher />
          <ThemeSwitch size="lg" />
        </div>

        <div className="shrink-0 border-t border-border px-4 py-4">
          {isLoggedIn ? (
            // The shared account rows are sized for the desktop dropdown; this
            // is a touch surface, so they take the 44px density in place.
            <div className="space-y-1 [&>button]:min-h-11 [&>button]:rounded-control">
              <UserMenuHeader />
              <div className="my-2 h-px bg-border" />
              <UserMenuItems variant="plain" onItemClick={close} />
            </div>
          ) : (
            <div className="space-y-2">
              <Link href="/register" onClick={close} className={cn('w-full', CTA_PRIMARY)}>
                {t('register')}
              </Link>
              <Link href="/login" onClick={close} className={cn('w-full', CTA_QUIET)}>
                {t('login')}
              </Link>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
