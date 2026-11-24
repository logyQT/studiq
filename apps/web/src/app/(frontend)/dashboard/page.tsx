'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { useOrgs } from '@/hooks/use-orgs';
import { usePermissions } from '@/hooks/use-permissions';
import { resolveLandingArea } from '@/lib/dashboard-home';

/**
 * The neutral authenticated landing. `/login` and `/register` redirect a
 * signed-in visitor here (the proxy cannot know their area), `/setup` returns
 * here once onboarding settles, and `/billing/success` sends them here after a
 * purchase — one place decides which of `/manage`, `/edu` or `/app` is home.
 *
 * The decision is permission-based (ADR-0015 §7.1) and therefore client-side:
 * it waits for a `/me/permissions` answer whose `orgId` names the org this
 * caller is now in, then replaces itself. Nothing is fetched before a session
 * exists — both queries are `enabled` on the AuthProvider's user (#458) — so
 * this page never issues a cookie-less authority call.
 */
export default function DashboardLandingPage() {
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();
  const { activeOrg, isPending: orgsPending, isSwitching } = useOrgs();
  const permissions = usePermissions();

  // A failed session while the page is open is not a landing decision; the login
  // form is the only surface that can recover it.
  const signedOut = !isAuthLoading && !user;

  const area = resolveLandingArea({
    orgsPending,
    isSwitching,
    activeOrgId: activeOrg?.id ?? null,
    permissions: permissions.data,
  });

  const resolved = useRef(false);

  useEffect(() => {
    if (resolved.current) return;
    if (signedOut) {
      resolved.current = true;
      router.replace('/login');
      return;
    }
    if (!area) return;
    resolved.current = true;
    router.replace(area);
  }, [signedOut, area, router]);

  return (
    <div className="flex min-h-svh items-center justify-center">
      <Loader2 aria-hidden className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
