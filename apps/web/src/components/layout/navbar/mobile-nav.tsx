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
import { ArrowRight, GraduationCap, Menu, User, X } from 'lucide-react';
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
  /** Already translated: the drawer's destinations span three i18n namespaces. */
  label: string;
  href: string;
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

/** `signal` fill / `ink` text: the menu's one primary action (DESIGN §Dosage). */
const CTA_PRIMARY = cn(
  'inline-flex h-12 items-center justify-center rounded-control bg-signal px-6 text-base font-semibold text-signal-foreground transition-colors hover:bg-signal/90',
  FOCUS_RING,
);

/**
 * The phone menu is a full-page takeover, not a side panel.
 *
 * A drawer is the wrong shape here: it leaves a strip of the page visible, it has
 * to fill height it does not need, and at 390px a panel that slides in from an
 * edge reads as an overlay on top of the site rather than as the site's own
 * navigation. Instead the menu replaces the page in place — it drops from under
 * the header, the destinations are set large with generous rows, and the single
 * primary action sits near the bottom where the thumb is.
 *
 * Only "Zarejestruj się" is offered as a button. Someone who already has an
 * account looks for the account mark in the top bar (the same corner it lives in
 * once they are signed in); someone arriving for the first time needs one
 * unambiguous action, not a choice between two.
 *
 * `side="top"` is what supplies the in-place motion: the kit's slide-from-edge
 * animation, at full width and full height, is the menu expanding out of the
 * header. It keeps the kit's focus trap, Escape handling and scroll lock.
 */
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
        side="top"
        className={cn(
          // `h-dvh!` because the top variant sets `h-auto`; full width because this
          // is the page, not a panel over it.
          'flex h-dvh! w-full max-w-none flex-col gap-0 border-0 bg-background p-0 shadow-none',
          // The kit ships its own 16px close button with an English label; the top
          // bar carries a labelled 44px one instead.
          '[&>button:last-child]:hidden',
        )}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{t('mobile_menu')}</SheetTitle>
          <SheetDescription>{t('logo')}</SheetDescription>
        </SheetHeader>

        {/* Top bar: brand, account, close — three cells divided by hairlines, the
            account mark in the same corner it occupies when signed in. */}
        <div className="flex h-16 shrink-0 items-stretch border-b border-border">
          <Link
            href="/"
            onClick={close}
            className={cn('flex flex-1 items-center gap-2 pl-4', FOCUS_RING)}
          >
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
          </Link>

          {isLoggedIn ? null : (
            <Link
              href="/login"
              onClick={close}
              aria-label={t('login')}
              className={cn(
                'flex w-16 shrink-0 items-center justify-center border-l border-border',
                FOCUS_RING,
              )}
            >
              <User aria-hidden className="size-5" />
            </Link>
          )}

          <SheetClose asChild>
            <button
              type="button"
              aria-label={t('common_close')}
              className={cn(
                'flex w-16 shrink-0 items-center justify-center border-l border-border',
                FOCUS_RING,
              )}
            >
              <X aria-hidden className="size-5" />
            </button>
          </SheetClose>
        </div>

        {/* Destinations, set large: one line each, a full row to itself, so the
            list reads as the page's structure rather than as links in a box. */}
        <nav aria-label={t('mobile_menu')} className="min-h-0 flex-1 overflow-y-auto">
          <ul className="divide-y divide-input border-b border-border">
            {items.map(({ label, href }) => {
              const active = isActive(href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={close}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group flex min-h-20 items-center gap-4 px-4 text-2xl font-semibold tracking-tight text-foreground transition-colors hover:bg-accent',
                      active && 'bg-accent',
                      FOCUS_RING,
                    )}
                  >
                    <span className="flex-1">{label}</span>
                    <ArrowRight
                      aria-hidden
                      className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="shrink-0 px-4 py-6">
          {isLoggedIn ? (
            // Account rows are sized for the desktop dropdown; this is a touch
            // surface, so they take the 44px density in place.
            <div className="space-y-1 [&>button]:min-h-11 [&>button]:rounded-control">
              <UserMenuHeader />
              <div className="my-2 h-px bg-border" />
              <UserMenuItems variant="plain" onItemClick={close} />
            </div>
          ) : (
            <Link href="/register" onClick={close} className={cn('w-full', CTA_PRIMARY)}>
              {t('register')}
            </Link>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-3 [&>button]:h-11">
          <LanguageSwitcher />
          <ThemeSwitch size="lg" />
        </div>
      </SheetContent>
    </Sheet>
  );
}
