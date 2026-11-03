'use client';

import type { BillingSubscriptionView } from '@studiq/server/services/billing.service';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@studiq/ui';
import { ArrowRight, CheckCircle, Loader2, RefreshCw } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Suspense, useEffect, useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { apiGet, apiPost } from '@/lib/api';
import { resolveDashboardPath } from '@/lib/onboarding';

const POLL_INTERVAL_MS = 2_000;
const POLL_ATTEMPTS = 7;

type SuccessState = 'processing' | 'activated' | 'timeout' | 'redirecting';

function accountTypeOf(user: { app_metadata?: Record<string, unknown> } | null): string {
  const raw = user?.app_metadata?.account_type;
  return typeof raw === 'string' ? raw : 'student';
}

/**
 * Polls the shared read model after a Stripe Checkout (#662 §5.6 / X6).
 *
 * The webhook is authoritative, but the browser usually reaches `success_url`
 * before Stripe delivers it. Reconcile verifies the session belongs to the
 * caller and runs the same activation path; the poll then waits for the mirror
 * to reflect it. The mock checkout (`?redirect=auto`, no `session_id`) keeps the
 * old 3-second dashboard redirect.
 */
function BillingSuccessContent() {
  const t = useTranslations('BillingSuccessPage');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading: isAuthLoading } = useAuth();

  const sessionId = searchParams.get('session_id')?.trim() || null;
  const redirect = searchParams.get('redirect');
  const dashboardPath = resolveDashboardPath(accountTypeOf(user));

  const [state, setState] = useState<SuccessState>(sessionId ? 'processing' : 'redirecting');
  const [subscription, setSubscription] = useState<BillingSubscriptionView | null>(null);

  useEffect(() => {
    let cancelled = false;
    let redirectTimer: ReturnType<typeof setTimeout> | undefined;

    if (!sessionId) {
      if (redirect === 'auto') {
        redirectTimer = setTimeout(() => router.push(dashboardPath), 3_000);
      }

      return () => {
        if (redirectTimer !== undefined) clearTimeout(redirectTimer);
      };
    }

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });

    const poll = async () => {
      setState('processing');

      // Reconcile once; a failure is non-fatal because the webhook may already
      // be in flight and the poll below still observes its result.
      try {
        await apiPost('/api/v1/billing/reconcile', { sessionId });
      } catch {
        // Ignore: the read model poll is the source of truth for the UI.
      }

      for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
        if (cancelled) return;

        try {
          const view = await apiGet<BillingSubscriptionView>('/api/v1/billing/subscription');
          if (
            !cancelled &&
            view.planKey &&
            (view.status === 'active' || view.status === 'trialing' || view.status === 'past_due')
          ) {
            setSubscription(view);
            setState('activated');
            return;
          }
        } catch {
          // A transient read failure should not cancel the poll.
        }

        if (attempt < POLL_ATTEMPTS - 1) await sleep(POLL_INTERVAL_MS);
      }

      if (!cancelled) setState('timeout');
    };

    void poll();

    return () => {
      cancelled = true;
    };
  }, [sessionId, redirect, dashboardPath, router]);

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

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div
            className={`mx-auto rounded-full p-3 w-fit mb-4 ${
              isActivated || state === 'redirecting'
                ? 'bg-green-100 dark:bg-green-900/30'
                : 'bg-muted'
            }`}
          >
            {isActivated || state === 'redirecting' ? (
              <CheckCircle className="size-10 text-green-600" />
            ) : (
              <Loader2 className="size-10 animate-spin text-muted-foreground" />
            )}
          </div>
          <CardTitle className="text-2xl">
            {isProcessing
              ? t('processing_title')
              : isTimeout
                ? t('processing_title')
                : isActivated
                  ? t('activated_title')
                  : t('title')}
          </CardTitle>
          <p className="text-muted-foreground mt-2">
            {isProcessing
              ? t('processing_description')
              : isTimeout
                ? t('processing_description')
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
