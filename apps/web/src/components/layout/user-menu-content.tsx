'use client';

import { AccountType } from '@studiq/authz';
import { DropdownMenuItem, DropdownMenuSeparator, UserAvatar } from '@studiq/ui';
import { BadgeCheck, Bell, CreditCard, LogOut, Palette, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { LanguageMenuRow } from '@/components/shared/language-switcher/language-menu-row';
import { ThemeSwitch } from '@/components/shared/theme-switch/theme-switch';
import { OPEN_NOTIFICATIONS_EVENT } from '@/lib/notifications';
import { cn } from '@/lib/utils';

export function UserMenuHeader() {
  const { user } = useAuth();
  const t = useTranslations('DashboardLayout');
  const userName = user?.user_metadata?.name || user?.email?.split('@')[0] || t('default_user');

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

interface MenuEntryProps {
  variant: UserMenuVariant;
  onSelect?: () => void;
  destructive?: boolean;
  children: React.ReactNode;
}

/**
 * Renders a real Radix `DropdownMenuItem` inside a dropdown (keyboard reachable via
 * roving focus), or a plain button when rendered outside a menu context (e.g. a Sheet).
 */
function MenuEntry({ variant, onSelect, destructive, children }: MenuEntryProps) {
  if (variant === 'menu') {
    return (
      <DropdownMenuItem variant={destructive ? 'destructive' : 'default'} onSelect={onSelect}>
        {children}
      </DropdownMenuItem>
    );
  }
  return (
    <button
      type="button"
      className={cn(
        PLAIN_ITEM_CLASS,
        destructive && 'text-destructive hover:bg-destructive/10 hover:text-destructive',
      )}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}

function MenuDivider({ variant }: { variant: UserMenuVariant }) {
  return variant === 'menu' ? <DropdownMenuSeparator /> : <div className="h-px bg-border my-1" />;
}

export type UserMenuVariant = 'menu' | 'plain';

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
  const active = document.activeElement as HTMLElement | null;
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
       * Offer the notifications entry. It opens the bell of the dashboard header, so it is only
       * for menus inside a dashboard: the public pages have no bell and the entry would do nothing.
       */
      notifications?: boolean;
    }
  | {
      /** 'plain' — non-menu contexts such as the mobile navbar sheet. */
      variant: 'plain';
      onItemClick?: () => void;
      /** Mobile drawer: open the separate language view instead of expanding inline. */
      onOpenLanguage?: () => void;
      /** Same as the menu variant: only where the dashboard bell exists. */
      notifications?: boolean;
    };

export function UserMenuItems(props: UserMenuItemsProps) {
  const { onItemClick, notifications = false } = props;
  const variant: UserMenuVariant = props.variant ?? 'menu';
  const t = useTranslations('DashboardLayout');
  const router = useRouter();
  const { user } = useAuth();
  // The language row is the only language entry; it owns the panel and the
  // locale commit (see language-menu-row.tsx) so no surface re-implements them.
  const languageRow =
    props.variant === 'plain' ? (
      <LanguageMenuRow variant="plain" onOpen={props.onOpenLanguage} />
    ) : (
      <LanguageMenuRow variant="menu" />
    );

  const accountType = user?.app_metadata?.account_type as AccountType | undefined;
  const dashboardPrefix = (() => {
    switch (accountType) {
      case AccountType.EDUCATOR:
        return '/edu';
      case AccountType.MANAGER:
        return '/manage';
      default:
        return '/app';
    }
  })();

  async function handleLogout() {
    try {
      const res = await fetch('/api/v1/auth/logout', { method: 'POST' });
      if (!res.ok) throw new Error('Logout failed');
      window.location.href = '/login';
    } catch {
      window.location.href = '/login';
    }
  }

  return (
    <>
      <MenuEntry
        variant={variant}
        onSelect={() => {
          router.push(`${dashboardPrefix}/upgrade`);
          onItemClick?.();
        }}
      >
        <Sparkles className="size-4" />
        <span>{t('upgrade')}</span>
      </MenuEntry>

      <MenuDivider variant={variant} />

      <MenuEntry
        variant={variant}
        onSelect={() => {
          router.push(`${dashboardPrefix}/account`);
          onItemClick?.();
        }}
      >
        <BadgeCheck className="size-4 text-muted-foreground" />
        <span>{t('account')}</span>
      </MenuEntry>
      <MenuEntry
        variant={variant}
        onSelect={() => {
          router.push(`${dashboardPrefix}/billing`);
          onItemClick?.();
        }}
      >
        <CreditCard className="size-4 text-muted-foreground" />
        <span>{t('billing')}</span>
      </MenuEntry>
      {notifications && (
        <MenuEntry
          variant={variant}
          onSelect={() => {
            // The notification centre is the bell in the header; this opens it.
            window.dispatchEvent(new Event(OPEN_NOTIFICATIONS_EVENT));
            onItemClick?.();
          }}
        >
          <Bell className="size-4 text-muted-foreground" />
          <span>{t('notifications')}</span>
        </MenuEntry>
      )}

      <MenuDivider variant={variant} />

      {languageRow}

      <MenuDivider variant={variant} />

      {/* A setting, not a menu action: choosing a theme keeps the menu open so the hint stays visible (#635). */}
      <div className="flex items-center gap-2 px-2 py-1 text-sm">
        <Palette aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1">{t('theme')}</span>
        <ThemeSwitch size={variant === 'plain' ? 'lg' : 'sm'} />
      </div>

      <MenuDivider variant={variant} />

      <MenuEntry
        variant={variant}
        onSelect={() => {
          handleLogout();
          onItemClick?.();
        }}
        destructive
      >
        <LogOut className="size-4" />
        <span>{t('logout')}</span>
      </MenuEntry>
    </>
  );
}
