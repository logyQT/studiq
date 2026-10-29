'use client';

import { AccountType } from '@studiq/authz';
import { DropdownMenuItem, DropdownMenuSeparator, UserAvatar } from '@studiq/ui';
import { BadgeCheck, CreditCard, LogOut, Palette, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/components/providers/AuthProvider';
import { LanguageMenuRow } from '@/components/shared/language-switcher/language-menu-row';
import { ThemeSwitch } from '@/components/shared/theme-switch/theme-switch';
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

export type UserMenuItemsProps =
  | {
      variant?: 'menu';
      onItemClick?: () => void;
    }
  | {
      /** 'plain' — non-menu contexts such as the mobile navbar sheet. */
      variant: 'plain';
      onItemClick?: () => void;
      /** Mobile drawer: open the separate language view instead of expanding inline. */
      onOpenLanguage?: () => void;
    };

export function UserMenuItems(props: UserMenuItemsProps) {
  const { onItemClick } = props;
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
      {/*
       * TODO(notifications): hidden in #280 — this entry had no destination and only closed
       * the menu. Re-add it here (and `DashboardLayout.notifications` in both locale files)
       * once a notifications surface exists. Intended shape:
       * - system notifications pushed by platform ops;
       * - manager notifications to the whole organization or to specific groups;
       * - notifications when new content is shared — opt-in/out per user, with a teacher
       *   override to force-notify on share (tick in the content share menu);
       * - always-on notifications when a new assignment appears, repeated as the deadline
       *   approaches;
       * - the model must stay expandable; good candidate for its own service.
       */}

      <MenuDivider variant={variant} />

      {languageRow}

      <MenuDivider variant={variant} />

      {/* A setting, not a menu action: choosing a theme keeps the menu open so the hint stays visible (#635). */}
      <div className="flex items-center gap-2 px-2 py-1 text-sm">
        <Palette aria-hidden="true" className="size-4 text-muted-foreground" />
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
