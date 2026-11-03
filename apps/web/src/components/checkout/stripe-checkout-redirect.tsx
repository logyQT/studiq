'use client';

import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@studiq/ui';
import { AlertCircle, ArrowLeft, CreditCard, Loader2, RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { apiPost } from '@/lib/api';
import { dashboardPathForAccountType } from '@/lib/billing-success';
import {
  type CheckoutFailure,
  checkoutFailureFor,
  checkoutSessionBody,
  type CheckoutStartupStatus,
  initialCheckoutStatus,
  isAllowedStripeCheckoutUrl,
} from '@/lib/checkout-entry';

interface StripeCheckoutRedirectProps {
  /** Catalog plan key from `?plan_id=` (`spark`, `hub`, …). */
  planKey: string;
  /** Organization from `?org_id=`; the server ignores it for personal plans. */
  orgId: string | null;
  /** `true` when hosted Checkout sent the customer back via `cancel_url`. */
  canceled: boolean;
}

type RedirectStatus = CheckoutStartupStatus | 'failed';

/**
 * The `stripe`-mode `/checkout` entry (#662 §5.6).
 *
 * The page is a deep link from `/pricing`; instead of a card form it starts the
 * hosted Checkout Session on mount and navigates to Stripe. The client never
 * supplies an amount, price or owner: only the plan key (and the organization
 * hint) travel, and `BillingService` re-checks both.
 *
 * A cancellation is deliberately **not** retried automatically — the cancel
 * URL points back here with `?canceled=1`, so retrying on mount would loop the
 * customer between our page and Stripe forever.
 */
export function StripeCheckoutRedirect({ planKey, orgId, canceled }: StripeCheckoutRedirectProps) {
  const t = useTranslations('CheckoutPage');
  const locale = useLocale();
  const { user } = useAuth();
  const [status, setStatus] = useState<RedirectStatus>(() =>
    initialCheckoutStatus({ planKey, canceled }),
  );
  const [failure, setFailure] = useState<CheckoutFailure | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (status !== 'starting' || started.current) return;
    // The ref is the once-only guard. Do **not** combine it with a
    // mount-scoped cancel flag: React Strict Mode runs the effect twice in
    // development, so the second run would skip and the first run's cleanup
    // would discard the only redirect.
    started.current = true;

    void (async () => {
      try {
        const { url } = await apiPost<{ url: string }>(
          '/api/v1/stripe/create-checkout-session',
          checkoutSessionBody({
            planKey,
            orgId,
            locale: locale === 'en' ? 'en' : 'pl',
          }),
        );

        if (!isAllowedStripeCheckoutUrl(url)) {
          started.current = false;
          setFailure({ code: null, retryable: true, manageSubscription: false });
          setStatus('failed');
          return;
        }

        window.location.assign(url);
      } catch (error) {
        started.current = false;
        setFailure(checkoutFailureFor(error));
        setStatus('failed');
      }
    })();
  }, [status, locale, orgId, planKey]);

  function retry() {
    if (!planKey) return;
    started.current = false;
    setFailure(null);
    setStatus('starting');
  }

  const backPath = orgId ? '/pricing/org' : '/pricing';
  const rawAccountType: unknown = user?.app_metadata?.account_type;
  const billingHref = `${dashboardPathForAccountType(rawAccountType)}/billing`;
  const canRetry = status === 'canceled' || (status === 'failed' && failure?.retryable === true);

  const title =
    status === 'missing-plan'
      ? t('missing_plan_title')
      : status === 'canceled'
        ? t('payment_canceled')
        : status === 'failed'
          ? failure?.manageSubscription
            ? t('already_subscribed')
            : failure?.retryable
              ? t('payment_failed_title')
              : t('checkout_unavailable_title')
          : t('redirecting_to_stripe');

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mx-auto rounded-full bg-primary/10 p-3 w-fit mb-4">
            {status === 'failed' || status === 'missing-plan' ? (
              <AlertCircle className="size-8 text-destructive" />
            ) : (
              <Loader2 className="size-8 animate-spin text-primary" />
            )}
          </div>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === 'canceled' && (
            <Alert>
              <AlertCircle />
              <AlertDescription>{t('payment_canceled_description')}</AlertDescription>
            </Alert>
          )}

          {status === 'missing-plan' && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{t('missing_plan_description')}</AlertDescription>
            </Alert>
          )}

          {status === 'failed' && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>
                {failure?.manageSubscription
                  ? t('already_subscribed_description')
                  : failure?.retryable
                    ? t('payment_failed')
                    : t('checkout_unavailable_description')}
              </AlertDescription>
            </Alert>
          )}

          {status === 'starting' && (
            <p className="text-sm text-muted-foreground">{t('payment_processing')}</p>
          )}

          <div className="flex flex-wrap items-center justify-center gap-2">
            {canRetry && (
              <Button onClick={retry}>
                <RefreshCw className="size-4 mr-2" />
                {t('retry')}
              </Button>
            )}

            {status === 'failed' && failure?.manageSubscription && (
              <Button asChild>
                <a href={billingHref}>
                  <CreditCard className="size-4 mr-2" />
                  {t('manage_subscription')}
                </a>
              </Button>
            )}

            <Button variant="outline" asChild>
              <a href={backPath}>
                <ArrowLeft className="size-4 mr-2" />
                {t('back_to_plans')}
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
