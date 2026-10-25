'use client';

import { ArrowLeft, GraduationCap } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/components/providers/AuthProvider';
import { useOrgs } from '@/hooks/use-orgs';
import { resolveDashboardPath, resolveSetupGate } from '@/lib/onboarding';

/**
 * Static brand + the one contextual escape link for the first-run setup pages.
 *
 * The brand is deliberately not a link: the Navbar brand goes to `/`, which is
 * a surprise inside an onboarding flow. The link rules:
 * - already onboarded (settled, >0 orgs) → the account dashboard;
 * - onboarded sub-page (`/setup/join`, `/setup/classroom`) → back to the chooser;
 * - freshly onboarded chooser, or a manager (whose only setup page is
 *   `/setup/org`) → no link, because it would bounce straight back.
 */
export function SetupHeader() {
  const t = useTranslations('SetupPage');
  const pathname = usePathname();
  const { user } = useAuth();
  const { orgs, isPending, isFetching } = useOrgs();

  const gate = resolveSetupGate({ orgsCount: orgs.length, isPending, isFetching });
  const onChooser = pathname === '/setup';
  const accountType = user?.app_metadata?.account_type as string | undefined;

  const back =
    gate === 'dashboard'
      ? { href: resolveDashboardPath(accountType), label: t('back_to_dashboard') }
      : !onChooser && accountType !== 'manager'
        ? { href: '/setup', label: t('back') }
        : null;

  return (
    <header className="flex items-center justify-between gap-4 border-b px-4 py-4 sm:px-6">
      <div className="flex items-center gap-2">
        <GraduationCap aria-hidden className="size-5 text-primary" />
        <span className="text-lg font-bold tracking-tight">StudiQ</span>
      </div>
      {back && (
        <Link
          href={back.href}
          className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {back.label}
        </Link>
      )}
    </header>
  );
}
