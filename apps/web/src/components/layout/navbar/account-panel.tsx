'use client';

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@studiq/ui';
import { useTranslations } from 'next-intl';
import type { RefObject } from 'react';
import { UserMenuHeader, UserMenuItems } from '@/components/layout/user-menu-content';
import { cn } from '@/lib/utils';
import { usePanelChrome } from '@/components/layout/navbar/use-panel-chrome';

/** The panel the header's account control points at while it is open. */
export const ACCOUNT_PANEL_ID = 'account-panel';

interface AccountPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The header's account control — where focus goes back when the panel closes. */
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}

/**
 * The account panel: who you are signed in as, and what you can do about it.
 *
 * It is the same surface the burger opens — full width, dropping from the
 * header's hairline to the bottom of the viewport, no side rail and no overlay —
 * because both are panels of this header, not drawers beside the page. Only the
 * content differs: the burger's panel is where you can go, this one is who you
 * are. That is also why the preference row is not duplicated here: language and
 * theme live in the navigation panel for signed-in and signed-out visitors
 * alike, so each control exists exactly once.
 *
 * The header owns the close: this panel carries no close control of its own.
 * Escape, the account mark that opened it (a toggle while it is open) and any
 * navigation close it, and focus returns to that mark. Opening the navigation
 * panel closes this one, and the reverse is true in `Navbar`.
 */
export function AccountPanel({ open, onOpenChange, returnFocusRef }: AccountPanelProps) {
  const t = useTranslations('Navbar');
  const { panelRef, close } = usePanelChrome(open, onOpenChange);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        id={ACCOUNT_PANEL_ID}
        ref={panelRef}
        side="top"
        // The panel covers the content, so there is nothing to dim and nothing to
        // dismiss by tapping outside: closing is the account mark, Escape, or a
        // header control (which closes through the header's own handler).
        onInteractOutside={(event) => event.preventDefault()}
        // Focus goes to the panel itself, not to its first row: the dialog
        // announces its name, and Tab then enters the list.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          panelRef.current?.focus();
        }}
        // Escape and an outside tap share the close path; the explicit focus
        // return covers the opener never having taken focus (a touch tap on iOS).
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
        className={cn(
          // The navigation panel's geometry, to the class: `top-16` is the
          // header (`h-16`), `bottom-0` the viewport, full width, and `z-40`
          // keeps it under the header's `z-50` so its hairline is the seam. Flat:
          // no border of its own, no radius, no shadow (DESIGN §Shape).
          'top-16 bottom-0 z-40 flex w-full max-w-none flex-col gap-0 overflow-hidden border-0 bg-background p-0 shadow-none',
          // The kit ships its own 16px close button with an English label; the
          // header owns the close, so this panel gets none.
          '[&>button:last-child]:hidden',
        )}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{t('user_menu')}</SheetTitle>
          <SheetDescription>{t('logo')}</SheetDescription>
        </SheetHeader>

        {/* The avatar block, ruled off from the rows below it like any other
            section of this panel. */}
        <div className="shrink-0 border-b border-border px-4 py-4">
          <UserMenuHeader />
        </div>

        {/* Account actions and logout, from the same set the desktop dropdown
            renders, with the preference rows off: those are the navigation
            panel's. Touch density, hairline rules between rows. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 pb-[max(1rem,env(safe-area-inset-bottom))] [&>button]:min-h-11 [&>button]:rounded-control [&>button]:px-3 [&>button+button]:border-t [&>button+button]:border-input">
          <UserMenuItems variant="plain" preferences={false} onItemClick={close} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
