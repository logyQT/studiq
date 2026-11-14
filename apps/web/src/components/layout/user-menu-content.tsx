'use client';

import { DropdownMenuItem, DropdownMenuSeparator, UserAvatar } from '@studiq/ui';
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  CreditCard,
  LogOut,
  Palette,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { PANEL_ROW, PANEL_ROW_ARROW, PANEL_ROW_ICON } from '@/components/layout/navbar/panel-rows';
import { useAuth } from '@/components/providers/AuthProvider';
import { LanguageMenuRow } from '@/components/shared/language-switcher/language-menu-row';
import { ThemeSwitch } from '@/components/shared/theme-switch/theme-switch';
import { dashboardHomeFor } from '@/lib/dashboard-home';
import { OPEN_NOTIFICATIONS_EVENT } from '@/lib/notifications';
import { cn } from '@/lib/utils';

export function UserMenuHeader({ variant = 'menu' }: { variant?: 'menu' | 'panel' }) {
  const { user } = useAuth();
  const t = useTranslations('DashboardLayout');
  // `user_metadata` is an untyped Supabase map; `name` must be narrowed.
  const rawName: unknown = user?.user_metadata.name;
  const storedName = typeof rawName === 'string' ? rawName : '';
  const userName = storedName || user?.email?.split('@')[0] || t('default_user');

  if (variant === 'panel') {
    // The identity block adopts the row metrics — 72px band, 16px inset,
    // 12px gap, a 40px avatar in the leading-icon column — so it reads as the
    // list's first row rather than a header bolted onto one.
    return (
      <div className="flex min-h-18 items-center gap-3 px-4 py-3 text-left">
        <UserAvatar name={userName} email={user?.email} size={20} className="size-10 rounded-lg" />
        <div className="grid min-w-0 flex-1 text-left leading-tight">
          <span className="truncate text-base font-semibold tracking-tight">{userName}</span>
          <span className="truncate text-sm text-muted-foreground">{user?.email}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
      <UserAvatar name={userName} email={user?.email} size={20} className="size-8 rounded-lg" />
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{userName}</span>
        <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
      </div>
    </div>
  );
}

const PLAIN_ITEM_CLASS =
  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground transition-colors';

const DESTRUCTIVE_ITEM_CLASS = 'text-destructive hover:bg-destructive/10 hover:text-destructive';

async function handleLogout() {
  try {
    const res = await fetch('/api/v1/auth/logout', { method: 'POST' });
    if (!res.ok) throw new Error('Logout failed');
    window.location.href = '/login';
  } catch {
    window.location.href = '/login';
  }
}

interface MenuEntryProps {
  variant: UserMenuVariant;
  onSelect?: () => void;
  destructive?: boolean;
  /** The leading icon; the panel draws it at the shared 20px, a dropdown at the kit's 16px. */
  icon?: LucideIcon;
  label: string;
  /** Panel rows that navigate carry the same arrow as the navigation panel. */
  arrow?: boolean;
  /** Dropdown-only icon tone, so the desktop menu keeps its established colours. */
  iconClassName?: string;
}

/**
 * Renders a real Radix `DropdownMenuItem` inside a dropdown (keyboard reachable via
 * roving focus), or a plain button when rendered outside a menu context (e.g. a Sheet).
 */
function MenuEntry({
  variant,
  onSelect,
  destructive,
  icon: Icon,
  label,
  arrow = false,
  iconClassName,
}: MenuEntryProps) {
  if (variant === 'menu') {
    return (
      <DropdownMenuItem variant={destructive ? 'destructive' : 'default'} onSelect={onSelect}>
        {Icon ? <Icon aria-hidden className={cn('size-4', iconClassName)} /> : null}
        <span>{label}</span>
      </DropdownMenuItem>
    );
  }
  return (
    <button
      type="button"
      className={cn(
        variant === 'panel' ? PANEL_ROW : PLAIN_ITEM_CLASS,
        destructive && DESTRUCTIVE_ITEM_CLASS,
      )}
      onClick={onSelect}
    >
      {Icon ? (
        <Icon
          aria-hidden
          className={cn(
            variant === 'panel' ? PANEL_ROW_ICON : cn('size-4', iconClassName),
            destructive && 'text-current',
          )}
        />
      ) : null}
      <span className="flex-1 text-left">{label}</span>
      {arrow ? <ArrowRight aria-hidden className={PANEL_ROW_ARROW} /> : null}
    </button>
  );
}

function MenuDivider({ variant }: { variant: UserMenuVariant }) {
  if (variant === 'menu') return <DropdownMenuSeparator />;
  // A panel's rows are divided by the list container itself — one full-bleed
  // rule between siblings — so its entries contribute no divider of their own.
  if (variant === 'panel') return null;
  return <div className="h-px bg-border my-1" />;
}

export type UserMenuVariant = 'menu' | 'plain' | 'panel';

/**
 * The destructive action, on its own so a surface can place it outside the list:
 * the header's account panel pins it as the panel's footer.
 */
export function UserMenuLogout({
  variant = 'menu',
  onItemClick,
}: {
  variant?: UserMenuVariant;
  onItemClick?: () => void;
}) {
  const t = useTranslations('DashboardLayout');

  return (
    <MenuEntry
      variant={variant}
      onSelect={() => {
        void handleLogout();
        onItemClick?.();
      }}
      destructive
      icon={LogOut}
      label={t('logout')}
    />
  );
}

/** Focus the checked radio of the inline theme switch (or the first one). */
function focusThemeRadio(themeGroup: HTMLElement | null): void {
  (
    themeGroup?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]') ??
    themeGroup?.querySelector<HTMLElement>('[role="radio"]')
  )?.focus();
}

/**
 * Keyboard access for the inline language select and theme switch.
 *
 * Radix cancels `Tab` inside `DropdownMenuContent`, and its roving focus only
 * visits `menuitem`s, so those two controls would be pointer-only. Keep the
 * panel and its markup exactly as they are; this only routes `Tab`:
 *
 *   items before settings → language select → theme switch → out of the menu
 *   (and back); the logout item after the settings rows already leaves forwards.
 *
 * The controls themselves keep their own keys (arrows/Enter/Space); see
 * `LanguageSelect` (stops the menu from also handling the arrows that open the
 * listbox) and `ThemeSwitch` (already stops arrow propagation).
 */
export function handleUserMenuTab(
  event: ReactKeyboardEvent<HTMLElement>,
  onClose: () => void,
): void {
  if (event.key !== 'Tab') return;

  const content = event.currentTarget;
  const active = document.activeElement;
  const language = content.querySelector<HTMLElement>('[role="combobox"]');
  const themeGroup = content.querySelector<HTMLElement>('[role="radiogroup"]');
  const items = [...content.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  // The menu item right before the settings rows in DOM order: the target for
  // Shift+Tab out of the language select (the roving item may be unset when the
  // menu was opened with the pointer).
  const itemBeforeLanguage = language
    ? items
        .filter(
          (item) =>
            (item.compareDocumentPosition(language) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        )
        .at(-1)
    : undefined;

  // Pointer-opened menus keep focus on the menu container (roving focus only
  // enters on keyboard open). Start the Tab path from the container.
  if (active === content) {
    event.preventDefault();
    if (event.shiftKey) onClose();
    else language?.focus();
    return;
  }

  // The menu's roving focus: move into the settings rows, backwards leaves.
  // Items after the settings rows (logout) must leave forwards instead of
  // jumping back to the select, and go back to the theme switch on Shift+Tab.
  if (active?.getAttribute('role') === 'menuitem') {
    const isAfterSettings =
      language != null &&
      (language.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    event.preventDefault();
    if (!isAfterSettings) {
      if (event.shiftKey) onClose();
      else language?.focus();
    } else if (event.shiftKey) {
      focusThemeRadio(themeGroup);
    } else {
      onClose();
    }
    return;
  }

  if (active && active === language) {
    event.preventDefault();
    if (event.shiftKey) itemBeforeLanguage?.focus();
    else focusThemeRadio(themeGroup);
    return;
  }

  // Inside the theme radiogroup: backwards returns to the select, forwards
  // leaves the menu (focus goes back to the trigger).
  if (active && themeGroup?.contains(active)) {
    event.preventDefault();
    if (event.shiftKey) language?.focus();
    else onClose();
  }
}

export type UserMenuItemsProps =
  | {
      variant?: 'menu';
      onItemClick?: () => void;
      /**
       * Render the language and theme rows. Off for a surface that leaves the
       * preferences to another panel, so one copy of each control exists in the DOM.
       */
      preferences?: boolean;
      /**
       * Offer the notifications entry. It opens the bell of the dashboard header, so it is only
       * for menus inside a dashboard: the public pages have no bell and the entry would do nothing.
       */
      notifications?: boolean;
      /**
       * Render the logout entry at the end of the set. Off on a surface that pins
       * it separately as its own footer (the header account panel).
       */
      logout?: boolean;
    }
  | {
      /** 'plain' — non-menu contexts; 'panel' — full-bleed rows of the header's panels. */
      variant: 'plain' | 'panel';
      onItemClick?: () => void;
      /** Mobile drawer: open the separate language view instead of expanding inline. */
      onOpenLanguage?: () => void;
      /** Same as the menu variant: the account panel leaves the preferences to the navigation panel. */
      preferences?: boolean;
      /** Same as the menu variant: only where the dashboard bell exists. */
      notifications?: boolean;
      /** Same as the menu variant: off where the logout is the panel's footer. */
      logout?: boolean;
    };

export function UserMenuItems(props: UserMenuItemsProps) {
  const { onItemClick, notifications = false, preferences = true, logout = true } = props;
  const variant: UserMenuVariant = props.variant ?? 'menu';
  const t = useTranslations('DashboardLayout');
  const router = useRouter();
  const { user } = useAuth();
  // The language row is the only language entry; it owns the panel and the
  // locale commit (see language-menu-row.tsx) so no surface re-implements them.
  const languageRow = preferences ? (
    props.variant === 'plain' ? (
      <LanguageMenuRow variant="plain" onOpen={props.onOpenLanguage} />
    ) : (
      <LanguageMenuRow variant="menu" />
    )
  ) : null;

  // `app_metadata` is an untyped Supabase map; `account_type` must be narrowed.
  const rawAccountType: unknown = user?.app_metadata.account_type;
  const accountType = typeof rawAccountType === 'string' ? rawAccountType : undefined;
  const dashboardPrefix = dashboardHomeFor(accountType);

  return (
    <>
      <MenuEntry
        variant={variant}
        icon={Sparkles}
        label={t('upgrade')}
        arrow={variant === 'panel'}
        onSelect={() => {
          router.push(`${dashboardPrefix}/upgrade`);
          onItemClick?.();
        }}
      />

      <MenuDivider variant={variant} />

      <MenuEntry
        variant={variant}
        icon={BadgeCheck}
        iconClassName="text-muted-foreground"
        label={t('account')}
        arrow={variant === 'panel'}
        onSelect={() => {
          router.push(`${dashboardPrefix}/account`);
          onItemClick?.();
        }}
      />
      <MenuEntry
        variant={variant}
        icon={CreditCard}
        iconClassName="text-muted-foreground"
        label={t('billing')}
        arrow={variant === 'panel'}
        onSelect={() => {
          router.push(`${dashboardPrefix}/billing`);
          onItemClick?.();
        }}
      />
      {notifications && (
        <MenuEntry
          variant={variant}
          icon={Bell}
          iconClassName="text-muted-foreground"
          label={t('notifications')}
          arrow={variant === 'panel'}
          onSelect={() => {
            // The notification centre is the bell in the header; this opens it.
            window.dispatchEvent(new Event(OPEN_NOTIFICATIONS_EVENT));
            onItemClick?.();
          }}
        />
      )}

      {preferences && (
        <>
          <MenuDivider variant={variant} />

          {languageRow}

          <MenuDivider variant={variant} />

          {/* A setting, not a menu action: choosing a theme keeps the menu open so the hint stays visible (#635). */}
          <div className="flex items-center gap-2 px-2 py-1 text-sm">
            <Palette aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1">{t('theme')}</span>
            <ThemeSwitch size={variant === 'plain' ? 'lg' : 'sm'} />
          </div>
        </>
      )}

      {logout && (
        <>
          <MenuDivider variant={variant} />
          <UserMenuLogout variant={variant} onItemClick={onItemClick} />
        </>
      )}
    </>
  );
}
