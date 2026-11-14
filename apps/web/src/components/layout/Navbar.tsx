'use client';

import { AccountType } from '@studiq/authz';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  UserAvatar,
} from '@studiq/ui';
import { GraduationCap, User } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { DesktopNav } from '@/components/layout/navbar/desktop-nav';
import { ACCOUNT_PANEL_ID, AccountPanel } from '@/components/layout/navbar/account-panel';
import { FOCUS_RING, HEADER_ICON } from '@/components/layout/navbar/chrome';
import { MobileNav } from '@/components/layout/navbar/mobile-nav';
import type { NavLink } from '@/components/layout/navbar/types';
import {
  UserMenuHeader,
  UserMenuItems,
  handleUserMenuTab,
} from '@/components/layout/user-menu-content';
import { useAuth } from '@/components/providers/AuthProvider';
import { useBranding } from '@/hooks/use-branding';
import { cn } from '@/lib/utils';

/*
 * Keys and paths mirror `app-sidebar.tsx`, which is the source of truth for the
 * dashboard. This list had drifted: `nav_my_questions` pointed at
 * `/app/my-questions`, a route that does not exist, and the labels disagreed with
 * the sidebar for the same destination ("Moje talie" vs "Fiszki").
 */
const studentLinks: NavLink[] = [
  { labelKey: 'app_overview', href: '/app', namespace: 'DashboardLayout' },
  { labelKey: 'app_flashcard_decks', href: '/app/flashcards', namespace: 'DashboardLayout' },
  { labelKey: 'question_banks', href: '/app/questions', namespace: 'DashboardLayout' },
  { labelKey: 'stats_data', href: '/app/stats/content', namespace: 'DashboardLayout' },
];

const teacherLinks: NavLink[] = [
  { labelKey: 'edu_overview', href: '/edu', namespace: 'DashboardLayout' },
  { labelKey: 'flashcard_decks', href: '/edu/flashcards', namespace: 'DashboardLayout' },
  { labelKey: 'question_banks', href: '/edu/questions', namespace: 'DashboardLayout' },
  // UI_HIDDEN: classroom section — stale for org-managed flow
  // { labelKey: 'nav_classroom', href: '/edu/classroom/members' },
  { labelKey: 'stats_data', href: '/edu/stats/data', namespace: 'DashboardLayout' },
];

const adminLinks: NavLink[] = [
  { labelKey: 'manage_overview', href: '/manage', namespace: 'DashboardLayout' },
  { labelKey: 'manage_members', href: '/manage/members', namespace: 'DashboardLayout' },
  { labelKey: 'manage_settings', href: '/manage/settings', namespace: 'DashboardLayout' },
];

const publicLinks: NavLink[] = [
  { labelKey: 'features', href: '/features' },
  { labelKey: 'pricing', href: '/pricing' },
];

/**
 * A solid/ghost pair, both in the brand colour: `Register` is a cobalt fill with
 * the inverse text, `Login` is its opposite — brand-coloured text on a control
 * border with no fill. `--primary-foreground` flips by theme (paper on cobalt in
 * light, ink on cobalt in dark), so the inverse text is automatic rather than
 * hardcoded.
 *
 * `signal` is deliberately absent here: it stays the page's single conversion
 * accent (hero, closing band), so the header never competes with it.
 */
const HEADER_ACTION = cn(
  'inline-flex h-9 items-center justify-center rounded-control px-4 text-sm transition-colors',
  FOCUS_RING,
);
const HEADER_LOGIN = cn(
  HEADER_ACTION,
  'border border-input font-medium text-primary hover:bg-secondary',
);
const HEADER_REGISTER = cn(
  HEADER_ACTION,
  'bg-primary font-semibold text-primary-foreground hover:bg-cobalt-hover',
);

export function Navbar() {
  const t = useTranslations('Navbar');
  const tLanding = useTranslations('LandingPage');
  const tFooter = useTranslations('Footer');
  const tDash = useTranslations('DashboardLayout');
  const { user, isLoading } = useAuth();
  const pathname = usePathname();
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const { logoUrl } = useBranding();
  const closeMobile = () => setMobileOpen(false);

  // `user_metadata` / `app_metadata` are untyped Supabase maps; narrow before use.
  const rawAccountType: unknown = user?.app_metadata.account_type;
  const accountType = typeof rawAccountType === 'string' ? rawAccountType : undefined;
  const rawName: unknown = user?.user_metadata.name;
  const userName = typeof rawName === 'string' ? rawName : undefined;

  const navLinks: NavLink[] = (() => {
    switch (accountType) {
      case AccountType.EDUCATOR:
        return [...teacherLinks, ...adminLinks];
      case AccountType.MANAGER:
        return adminLinks;
      default:
        return studentLinks;
    }
  })();

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  // A signed-in account gets the public links followed by its dashboard links;
  // anonymous visitors get the public links alone. `navLinks` never contains a
  // public target, so the two sets concatenate without duplicates.
  const allLinks = user ? [...publicLinks, ...navLinks] : publicLinks;

  /*
   * The mobile drawer navigates differently on purpose. Desktop leaves the page
   * for /features and /pricing; on a phone the sections of this page are the
   * destination, so the drawer jumps to them instead of reloading a second page
   * the visitor has to scroll from the top. Kontakt is a real page and stays one.
   * The labels come from three namespaces, which is why the drawer takes strings
   * rather than keys.
   */
  const mobileItems = user
    ? allLinks.map(({ labelKey, href, namespace }) => ({
        label: namespace === 'DashboardLayout' ? tDash(labelKey) : t(labelKey),
        href,
      }))
    : [
        { label: t('features'), href: '#features' },
        { label: tLanding('how_it_works_title'), href: '#how-it-works' },
        { label: t('pricing'), href: '#pricing' },
        { label: tFooter('contact'), href: '/contact' },
      ];

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* LEFT — one row, one baseline: the logo gets a control-height box so
              its centre is the row's centre, exactly like the links and the auth
              pair. The gap between logo and nav is the single spacing step. */}
          <div className="flex h-full min-w-0 flex-1 items-center gap-6">
            <Link
              href="/"
              onClick={closeMobile}
              className={cn(
                'inline-flex h-9 shrink-0 items-center gap-2 rounded-control text-xl font-bold tracking-tight transition-opacity hover:opacity-80',
                FOCUS_RING,
              )}
            >
              {/* Org logo replaces the default icon only when the `branding`
                  feature is on AND a logo is set; otherwise fall back to the
                  GraduationCap so default StudiQ branding is untouched. */}
              {logoUrl ? (
                <Image
                  src={logoUrl}
                  alt=""
                  width={24}
                  height={24}
                  className="h-6 w-6 rounded-sm object-contain"
                  unoptimized
                />
              ) : (
                <GraduationCap className="h-6 w-6 text-primary" />
              )}
              {t('logo')}
            </Link>

            {/* Desktop nav */}
            <div className="hidden h-full min-w-0 flex-1 items-center lg:flex">
              <DesktopNav links={allLinks} isActive={isActive} />
            </div>
          </div>

          {/* RIGHT — desktop only */}
          <div className="hidden shrink-0 items-center gap-2 sm:flex">
            {isLoading ? null : user ? (
              <DropdownMenu open={avatarOpen} onOpenChange={setAvatarOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t('user_menu')}
                    className="rounded-full transition hover:scale-105 active:scale-95"
                  >
                    <UserAvatar name={userName} email={user.email} size={36} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-60"
                  onKeyDown={(event) => handleUserMenuTab(event, () => setAvatarOpen(false))}
                >
                  <UserMenuHeader />
                  <DropdownMenuSeparator />
                  <UserMenuItems onItemClick={() => setAvatarOpen(false)} />
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <>
                <Link href="/login" className={HEADER_LOGIN}>
                  {t('login')}
                </Link>
                <Link href="/register" className={HEADER_REGISTER}>
                  {t('register')}
                </Link>
              </>
            )}
          </div>

          {/* Mobile account mark: one square, one corner, both states (PRODUCT §A
              surface visited once). Signed out it is the way in; signed in it
              toggles the account panel, which is the same surface the burger
              opens with a different job — links there, the account here. */}
          <div className="ml-2 flex shrink-0 items-center sm:hidden">
            {user ? (
              <button
                type="button"
                ref={accountTriggerRef}
                aria-label={t('user_menu')}
                aria-expanded={accountOpen}
                aria-controls={accountOpen ? ACCOUNT_PANEL_ID : undefined}
                onClick={() => {
                  const next = !accountOpen;
                  if (next) closeMobile();
                  setAccountOpen(next);
                }}
                // The burger's chrome, with no persisted fill: a filled square
                // reads as a pressed button. `aria-expanded` still carries the state.
                className={HEADER_ICON}
              >
                <User aria-hidden className="size-5" />
              </button>
            ) : (
              <Link
                href="/login"
                onClick={closeMobile}
                aria-label={t('login')}
                className={HEADER_ICON}
              >
                <User aria-hidden className="size-5" />
              </Link>
            )}
          </div>

          {/* The burger owns the panel it opens and nothing else: it stays in the
              header, keeps its position, and morphs into the X in place. `flex`
              here keeps its 44px square a flex item, not an inline box whose
              baseline would drop it half a pixel below the other two. */}
          <div className="ml-2 flex shrink-0 items-center lg:hidden">
            <MobileNav
              items={mobileItems}
              isActive={isActive}
              isLoggedIn={!!user}
              open={mobileOpen}
              onOpenChange={(next) => {
                setMobileOpen(next);
                // One panel at a time: the two never stack in the DOM.
                if (next) setAccountOpen(false);
              }}
            />
          </div>
        </div>
      </div>

      {user && (
        <AccountPanel
          open={accountOpen}
          onOpenChange={setAccountOpen}
          returnFocusRef={accountTriggerRef}
        />
      )}
    </header>
  );
}
