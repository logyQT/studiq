'use client';

import { Button, Skeleton } from '@studiq/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { useOrgs } from '@/hooks/use-orgs';
import { resolveDashboardPath, resolveSetupGate } from '@/lib/onboarding';

export default function SetupLandingPage() {
  const t = useTranslations('SetupPage');
  const router = useRouter();
  const { user } = useAuth();
  const { orgs, isPending, isFetching } = useOrgs();
  const gate = resolveSetupGate({ orgsCount: orgs.length, isPending, isFetching });
  const accountType = user?.app_metadata?.account_type as string | undefined;

  useEffect(() => {
    if (gate !== 'dashboard') return;
    // replace(), not push(): /setup must not stay in history, so "back" cannot
    // re-open the first-run chooser (same rule as setup/org).
    router.replace(resolveDashboardPath(accountType));
  }, [gate, accountType, router]);

  // The chooser is first-run only: render it only once the org list has
  // settled empty. While settling, keep the layout footprint so the redirect
  // is one stable paint and "Welcome to StudiQ" is never shown to an
  // already-onboarded user.
  if (gate !== 'onboarding') return <ChooserSkeleton />;

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('desc')}</p>
      <div className="pt-4 space-y-3">
        <Button
          variant="outline"
          className="w-full justify-start h-auto p-5 text-left"
          onClick={() => router.push('/setup/join')}
        >
          <div>
            <div className="font-medium">{t('join_option')}</div>
            <div className="text-sm text-muted-foreground">{t('join_option_desc')}</div>
          </div>
        </Button>
        <Button
          variant="outline"
          className="w-full justify-start h-auto p-5 text-left"
          onClick={() => router.push('/setup/classroom')}
        >
          <div>
            <div className="font-medium">{t('create_option')}</div>
            <div className="text-sm text-muted-foreground">{t('create_option_desc')}</div>
          </div>
        </Button>
      </div>
    </div>
  );
}

/** Matches the chooser footprint: title, description and two option rows. */
function ChooserSkeleton() {
  return (
    <div className="max-w-lg mx-auto space-y-4" aria-hidden>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-full" />
      <div className="pt-4 space-y-3">
        <Skeleton className="h-[74px] w-full rounded-lg" />
        <Skeleton className="h-[74px] w-full rounded-lg" />
      </div>
    </div>
  );
}
