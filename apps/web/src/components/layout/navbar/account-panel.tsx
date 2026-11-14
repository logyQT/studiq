'use client';

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@studiq/ui';
import { ArrowRight, Bell } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { RefObject } from 'react';
import {
  PANEL_LIST,
  PANEL_ROW,
  PANEL_ROW_ARROW,
  PANEL_ROW_ICON,
  PANEL_SHEET,
} from '@/components/layout/navbar/panel-rows';
import {
  UserMenuHeader,
  UserMenuItems,
  UserMenuLogout,
} from '@/components/layout/user-menu-content';
import { useAuth } from '@/components/providers/AuthProvider';
import { useNotifications } from '@/hooks/use-notifications';
import { dashboardHomeFor } from '@/lib/dashboard-home';
import { unreadBadge } from '@/lib/notifications';
import { usePanelChrome } from '@/components/layout/navbar/use-panel-chrome';

/** The panel the header's account control points at while it is open. */
export const ACCOUNT_PANEL_ID = 'account-panel';

/** The unread pill, at the row's type size: the bell's badge, one step up. */
const UNREAD_PILL =
  'min-w-6 rounded-full bg-destructive px-2 text-center text-sm font-semibold leading-6 text-destructive-foreground';

/**
 * Notifications are the one account surface with no page of its own: the centre
 * is the bell in the dashboard header (`DashboardLayout`), and its popover only
 * exists there. So this row does not open a popover nobody mounted — it takes
 * you to the dashboard header that has one, and carries the unread count from
 * the bell's own query (`useNotifications`), not a second implementation.
 *
 * The hook lives here, inside the panel, so the poll only runs while the panel
 * is open; a failed or loading read paints no badge rather than a false zero.
 */
function AccountNotificationsRow({ onNavigate }: { onNavigate: () => void }) {
  const t = useTranslations('Notifications');
  const tDashboard = useTranslations('DashboardLayout');
  const { user } = useAuth();
  // `app_metadata` is an untyped Supabase map; `account_type` must be narrowed.
  const rawAccountType: unknown = user?.app_metadata.account_type;
  const accountType = typeof rawAccountType === 'string' ? rawAccountType : undefined;

  const { data } = useNotifications();
  const unread = data?.unreadCount ?? 0;
  const badge = unreadBadge(unread);

  return (
    <Link href={dashboardHomeFor(accountType)} onClick={onNavigate} className={PANEL_ROW}>
      <Bell aria-hidden className={PANEL_ROW_ICON} />
      <span className="flex-1">{tDashboard('notifications')}</span>
      {badge ? (
        <>
          <span className="sr-only">{t('unread_count', { count: unread })}</span>
          <span aria-hidden className={UNREAD_PILL}>
            {badge}
          </span>
        </>
      ) : null}
      <ArrowRight aria-hidden className={PANEL_ROW_ARROW} />
    </Link>
  );
}

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
 * are. The row metrics (height, inset, type, icon and arrow) come from
 * `panel-rows.ts`, so the two panels cannot drift; rows that navigate carry the
 * burger's arrow, while logout — an action, not a destination — does not.
 *
 * The preference row is not duplicated here: language and theme live in the
 * navigation panel for signed-in and signed-out visitors alike, so each control
 * exists exactly once.
 *
 * The header owns the close: this panel carries no close control of its own.
 * Escape, the account mark that opened it (a toggle while it is open) and any
 * navigation close it, and focus returns to that mark. Opening the navigation
 * panel closes this one, and the reverse is true in `Navbar`.
 */
export function AccountPanel({ open, onOpenChange, returnFocusRef }: AccountPanelProps) {
  const t = useTranslations('Navbar');
  const { panelRef, close, onOpenAutoFocus } = usePanelChrome(open, onOpenChange);

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
        onOpenAutoFocus={onOpenAutoFocus}
        // Escape and an outside tap share the close path; the explicit focus
        // return covers the opener never having taken focus (a touch tap on iOS).
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
        className={PANEL_SHEET}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{t('user_menu')}</SheetTitle>
          <SheetDescription>{t('logo')}</SheetDescription>
        </SheetHeader>

        {/* Identity, at the shared 72px rows' inset and gap, ruled off from the
            list below. */}
        <div className="shrink-0 border-b border-input">
          <UserMenuHeader variant="panel" />
        </div>

        {/* The list — same rows, same rhythm as the navigation panel. It owns
            every hairline between siblings; a row draws no edge of its own, so
            no boundary can double. Preferences stay in the navigation panel. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className={PANEL_LIST}>
            <UserMenuItems variant="panel" preferences={false} logout={false} onItemClick={close} />
            <AccountNotificationsRow onNavigate={close} />
          </div>
        </div>

        {/* Footer — logout pinned to the bottom band, clear of the safe area,
            exactly where the navigation panel pins language and theme. */}
        <div className="shrink-0 border-t border-input pb-[max(1rem,env(safe-area-inset-bottom))]">
          <UserMenuLogout variant="panel" onItemClick={close} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
