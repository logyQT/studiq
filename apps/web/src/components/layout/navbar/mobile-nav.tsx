'use client';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@studiq/ui';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { HEADER_ICON } from '@/components/layout/navbar/chrome';
import {
  PANEL_LIST,
  PANEL_ROW,
  PANEL_ROW_ARROW,
  PANEL_SHEET,
} from '@/components/layout/navbar/panel-rows';
import { CtaButton } from '@/components/marketing/ui/cta-button';
import { LanguageSwitcher } from '@/components/shared/language-switcher/language-switcher';
import { ThemeSwitch } from '@/components/shared/theme-switch/theme-switch';
import { cn } from '@/lib/utils';
import { usePanelChrome } from '@/components/layout/navbar/use-panel-chrome';

interface MobileNavItem {
  /** Already translated: the menu's destinations span three i18n namespaces. */
  label: string;
  href: string;
}

interface MobileNavProps {
  items: MobileNavItem[];
  isActive: (href: string) => boolean;
  isLoggedIn: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * One bar of the burger. Three of them sit in a 16px box (`flex-col
 * justify-between`), so their centres are 7px apart and the outer two need
 * exactly that much travel to meet in the middle of the X.
 */
const BAR = 'h-0.5 w-5 rounded-full bg-current transition motion-reduce:transition-none';

/**
 * The two outer bars travel to the middle and cross. Tailwind v4 sets `translate`
 * and `rotate` as their own properties, so `transform: none` would not cancel
 * them: the reduced-motion reset names each one instead. With motion off the bars
 * stay a burger and only the middle one, which fades rather than moves, reacts.
 */
const BAR_OPEN_UP =
  'translate-y-[7px] rotate-45 motion-reduce:translate-y-0 motion-reduce:rotate-0';
const BAR_OPEN_DOWN =
  '-translate-y-[7px] -rotate-45 motion-reduce:translate-y-0 motion-reduce:rotate-0';

const PANEL_ID = 'mobile-nav-panel';

/**
 * The phone menu is a panel under the header, never a replacement for it.
 *
 * The header is the constant: its logo, account mark and this burger stay where
 * they are and stay interactive for as long as the menu is open, because they
 * are how a visitor acts without navigating and how they leave. So the panel
 * owns only what belongs to the menu — the destinations, the preference row and,
 * signed out, the one primary action — and draws no chrome of its own. One
 * control closes it: this burger, which morphs into an X in place.
 *
 * Signed in, the panel is the list plus the preference row: the account surface
 * (who you are, plan, account, payments, logout) is the header account mark's
 * own panel. Language and theme therefore have exactly one home for everyone —
 * right here — instead of moving house with the sign-in state.
 *
 * That ownership is what `modal={false}` buys. Radix's modal dialog would put an
 * overlay over the header, trap focus behind it and lock scroll, all of which
 * would make the header look present but be dead. Non-modal keeps the header
 * live, ships no overlay (the panel is opaque and covers the content anyway) and
 * leaves Escape and focus restoration to the dialog's own content: on close it
 * returns focus to this trigger. What it stops doing is locking the page, so the
 * scroll lock below is ours.
 */
export function MobileNav({ items, isActive, isLoggedIn, open, onOpenChange }: MobileNavProps) {
  const t = useTranslations('Navbar');
  const { panelRef, close, onOpenAutoFocus } = usePanelChrome(open, onOpenChange);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-expanded={open}
          // The panel is unmounted when closed, and a reference to a missing node
          // is an a11y error — so the pointer exists only while the target does.
          aria-controls={open ? PANEL_ID : undefined}
          aria-label={open ? t('common_close') : t('mobile_menu')}
          className={cn('-ml-2', HEADER_ICON)}
        >
          <span aria-hidden className="flex h-4 w-5 flex-col justify-between">
            <span className={cn(BAR, open && BAR_OPEN_UP)} />
            <span className={cn(BAR, open && 'opacity-0')} />
            <span className={cn(BAR, open && BAR_OPEN_DOWN)} />
          </span>
        </button>
      </SheetTrigger>

      <SheetContent
        id={PANEL_ID}
        ref={panelRef}
        side="top"
        // The panel covers the content, so there is nothing to dim and nothing to
        // dismiss by tapping outside: closing is the burger, Escape, or a header
        // control (which closes through the header's own handler).
        onInteractOutside={(event) => event.preventDefault()}
        // Focus goes to the panel itself, not to its first control: the dialog
        // announces its name, and Tab then enters the list.
        onOpenAutoFocus={onOpenAutoFocus}
        className={PANEL_SHEET}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{t('mobile_menu')}</SheetTitle>
          <SheetDescription>{t('logo')}</SheetDescription>
        </SheetHeader>

        {/* Destinations, at the shared panel row: one line each, a full row to
            itself, so the list reads as the page's structure rather than as
            links in a box. The list owns the hairlines between rows. */}
        <nav
          aria-label={t('mobile_menu')}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <ul className={PANEL_LIST}>
            {items.map(({ label, href }) => {
              const active = isActive(href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={close}
                    aria-current={active ? 'page' : undefined}
                    className={cn(PANEL_ROW, active && 'bg-accent')}
                  >
                    <span className="flex-1">{label}</span>
                    <ArrowRight aria-hidden className={PANEL_ROW_ARROW} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {isLoggedIn ? null : (
          <div className="shrink-0 border-t border-input px-4 py-6">
            <CtaButton href="/register" size="lg" fullWidth onClick={close}>
              {t('register')}
            </CtaButton>
          </div>
        )}

        {/* The preference row is the panel's, signed in or out: language and theme
            live here for everyone rather than moving to the account panel, so
            each control exists exactly once. It owns its top edge; the list above
            does not also draw one, so the boundary is a single hairline. */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-input px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] [&>button]:h-11">
          <LanguageSwitcher touch />
          <ThemeSwitch size="lg" />
        </div>
      </SheetContent>
    </Sheet>
  );
}
