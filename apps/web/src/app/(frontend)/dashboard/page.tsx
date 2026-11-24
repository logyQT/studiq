'use client';

import { Button } from '@studiq/ui';
import { AlertCircle, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { EmptyState } from '@/components/shared/empty-state';
import { useOrgs } from '@/hooks/use-orgs';
import { usePermissions } from '@/hooks/use-permissions';
import { resolveLandingArea } from '@/lib/dashboard-home';

/**
 * The neutral authenticated landing. `/login` and `/register` redirect a
 * signed-in visitor here (the proxy cannot know their area), `/setup` returns
 * here once onboarding settles, and `/billing/success` sends them here after a
 * purchase — one place decides which of `/manage`, `/edu` or `/app` is home, or
 * whether the caller still has to onboard.
 *
 * The decision is permission-based (ADR-0015 §7.1) and therefore client-side:
 * it waits for a `/me/permissions` answer whose `orgId` names the org this
 * caller is now in, then replaces itself. Nothing is fetched before a session
 * exists — both queries are `enabled` on the AuthProvider's user (#458) — so
 * this page never issues a cookie-less authority call.
 */
export default function DashboardLandingPage() {
  const t = useTranslations('DashboardLanding');
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();
  const {
    orgs,
    activeOrg,
    accountType,
    isPending: orgsPending,
    isFetching: orgsFetching,
    isSwitching,
    isError: orgsError,
    refetch: refetchOrgs,
  } = useOrgs();
  const permissions = usePermissions();

  // A failed session while the page is open is not a landing decision; the login
  // form is the only surface that can recover it.
  const signedOut = !isAuthLoading && !user;

  const area = resolveLandingArea({
    orgsCount: orgs.length,
    orgsPending,
    orgsFetching,
    isSwitching,
    activeOrgId: activeOrg?.id ?? null,
    accountType,
    permissions: permissions.data,
  });

  // A failed `/me/orgs` taints every answer below it, and a failed permissions
  // call is only a dead end when it is actually needed: a settled first-run
  // account reaches `/setup*` without the map, so it is not trapped here.
  const failed = orgsError || (permissions.isError && area === null);

  const resolved = useRef(false);

  useEffect(() => {
    if (resolved.current) return;
    if (signedOut) {
      resolved.current = true;
      router.replace('/login');
      return;
    }
    if (failed || !area) return;
    resolved.current = true;
    router.replace(area);
  }, [signedOut, failed, area, router]);

  if (failed) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <EmptyState
          icon={AlertCircle}
          role="alert"
          title={t('load_error')}
          description={t('load_error_desc')}
          action={
            <div className="flex flex-col items-center gap-2">
              <Button
                onClick={() => {
                  void refetchOrgs();
                  void permissions.refetch();
                }}
              >
                {t('retry')}
              </Button>
              <Button asChild variant="ghost">
                <Link href="/login">{t('sign_in_again')}</Link>
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-svh items-center justify-center">
      <Loader2 aria-hidden className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
