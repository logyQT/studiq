'use client';

import type { BillingSubscriptionView } from '@studiq/server/services/billing.service';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@studiq/ui';
import { ArrowRight, CheckCircle, Loader2, RefreshCw } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Suspense, useEffect, useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { apiGet, apiPost } from '@/lib/api';
import { dashboardPathForAccountType, pollBillingActivation } from '@/lib/billing-success';

type SuccessState = 'processing' | 'activated' | 'timeout' | 'redirecting';

function accountTypeOf(user: { app_metadata?: Record<string, unknown> } | null): unknown {
  return user?.app_metadata?.account_type;
}

/**
 * Post-checkout landing page (#662 §5.6 / X6).
 *
 * The webhook is authoritative, but the browser usually arrives before Stripe
 * delivers it. We switch to the purchased organization (when the success URL
 * names one), reconcile once to verify ownership and reuse the idempotent
 * activation path, then poll the shared read model for up to ~15 s.
 *
 * The mock checkout (`?redirect=auto`, no `session_id`) keeps the old 3-second
 * dashboard redirect.
 */
function BillingSuccessContent() {
  const t = useTranslations('BillingSuccessPage');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading: isAuthLoading } = useAuth();

  const sessionId = searchParams.get('session_id')?.trim() || null;
  const purchasedPlanKey = searchParams.get('plan_id')?.trim() || null;
  const orgId = searchParams.get('org_id')?.trim() || null;
  const dashboardPath = dashboardPathForAccountType(accountTypeOf(user));

  const [state, setState] = useState<SuccessState>(sessionId ? 'processing' : 'redirecting');
  const [subscription, setSubscription] = useState<BillingSubscriptionView | null>(null);

  useEffect(() => {
    // `useAuth` starts as `null`; without this gate the effect re-runs when the
    // real account type arrives and reconciles/polls a second time.
    if (isAuthLoading) return () => {};

    if (!sessionId) {
      const timer = setTimeout(() => router.push(dashboardPath), 3_000);
      return () => clearTimeout(timer);
    }

    let cancelled = false;
    let sleepTimer: ReturnType<typeof setTimeout> | undefined;

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        sleepTimer = setTimeout(resolve, ms);
      });

    const run = async () => {
      setState('processing');

      // An organization checkout can target a non-active org. Switch to it so
      // the authenticated reconcile and the read-model poll both see that org;
      // the switch endpoint re-checks membership and sets the cookie.
      if (orgId) {
        try {
          await apiPost('/api/v1/me/orgs/switch', { orgId });
        } catch {
          // Reconcile will refuse a foreign org; fall through to its error path.
        }
      }

      const result = await pollBillingActivation({
        reconcile: () => apiPost('/api/v1/billing/reconcile', { sessionId }),
        readSubscription: () => apiGet<BillingSubscriptionView>('/api/v1/billing/subscription'),
        expectedPlanKey: purchasedPlanKey,
        sleep,
        isCancelled: () => cancelled,
      });

      if (result.state === 'cancelled') return;
      if (result.state === 'activated') {
        setSubscription(result.subscription);
        setState('activated');
        return;
      }

      setState('timeout');
    };

    void run();

    return () => {
      cancelled = true;
      if (sleepTimer !== undefined) clearTimeout(sleepTimer);
    };
  }, [sessionId, orgId, isAuthLoading, dashboardPath, router, purchasedPlanKey]);

  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isProcessing = state === 'processing';
  const isActivated = state === 'activated';
  const isTimeout = state === 'timeout';
  const isDone = isActivated || state === 'redirecting';

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div
            className={`mx-auto rounded-full p-3 w-fit mb-4 ${
              isDone ? 'bg-green-100 dark:bg-green-900/30' : 'bg-muted'
            }`}
          >
            {isDone ? (
              <CheckCircle className="size-10 text-green-600" />
            ) : isTimeout ? (
              <RefreshCw className="size-10 text-muted-foreground" />
            ) : (
              <Loader2 className="size-10 animate-spin text-muted-foreground" />
            )}
          </div>
          <CardTitle className="text-2xl">
            {isProcessing
              ? t('processing_title')
              : isTimeout
                ? t('timeout_title')
                : isActivated
                  ? t('activated_title')
                  : t('title')}
          </CardTitle>
          <p className="text-muted-foreground mt-2">
            {isProcessing
              ? t('processing_description')
              : isTimeout
                ? t('timeout_description')
                : isActivated
                  ? t('activated_description', {
                      plan: subscription?.planName ?? subscription?.planKey ?? '',
                    })
                  : t('description')}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {state === 'redirecting' && (
            <p className="text-sm text-muted-foreground">{t('redirecting')}</p>
          )}

          {isTimeout && (
            <Button variant="outline" className="w-full" onClick={() => window.location.reload()}>
              <RefreshCw className="size-4 mr-2" />
              {t('refresh')}
            </Button>
          )}

          <Button
            className="w-full"
            disabled={isProcessing}
            onClick={() => router.push(dashboardPath)}
          >
            {t('go_dashboard')} <ArrowRight className="size-4 ml-2" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function BillingSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center p-4">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <BillingSuccessContent />
    </Suspense>
  );
}
