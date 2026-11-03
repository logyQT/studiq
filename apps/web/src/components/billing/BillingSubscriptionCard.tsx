'use client';

import { AccountType } from '@studiq/authz';
import type { ChangePlanResult } from '@studiq/server/lib/payment/payment-gateway';
import type { BillingSubscriptionView } from '@studiq/server/services/billing.service';
import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { Button, Card, CardContent, CardHeader, CardTitle, Separator } from '@studiq/ui';
import { CreditCard, ExternalLink, Loader2, RefreshCw, Undo2, XCircle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  alternativePlans,
  billingStatusKey,
  hasProviderActions,
  invoiceHref,
  noActionsMessageKey,
  periodRow,
  planChangeFeedback,
} from '@/lib/billing-subscription';
import { apiGet, apiPost, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/datetime';

interface BillingSubscriptionCardProps {
  subscription: BillingSubscriptionView | undefined;
  isError?: boolean;
  onRetry?: () => void;
  plans: PlanInfo[] | undefined;
  accountType: AccountType;
  /** Re-read the shared model (and the plan) after a provider action. */
  onChanged: () => void;
}

/** The webhook usually lands within a second; nudge the read model once more. */
const APPLIED_REFRESH_MS = 2_500;

/**
 * Provider actions shared by the three billing dashboards (#662 §7.4).
 *
 * Every action hits an authenticated endpoint that resolves the owner from the
 * request context; nothing here decides who owns the subscription. The read
 * model is re-fetched after a mutation, and the plan itself only changes when
 * the webhook arrives.
 *
 * This card deliberately renders **no Badge**: the billing QA specs assert the
 * plan badge counts on the surrounding plan card.
 */
export function BillingSubscriptionCard({
  subscription,
  isError = false,
  onRetry,
  plans,
  accountType,
  onChanged,
}: BillingSubscriptionCardProps) {
  const t = useTranslations('BillingPage');
  const locale = useLocale();
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingInvoiceUrl, setPendingInvoiceUrl] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      if (refreshTimer.current !== undefined) clearTimeout(refreshTimer.current);
    },
    [],
  );

  if (isError) {
    return (
      <Card>
        <CardContent className="space-y-3 py-6 text-sm">
          <p className="text-destructive">{t('load_failed')}</p>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="size-4 mr-2" />
              {t('retry')}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  if (!subscription) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const statusKey = billingStatusKey(subscription.status);
  const statusLabel = statusKey ? t(statusKey) : subscription.status;
  const period = periodRow(subscription);
  const planName = (key: string) => plans?.find((plan) => plan.key === key)?.name ?? key;
  const actions = hasProviderActions(subscription);
  const alternatives = alternativePlans(plans, subscription, accountType);

  const fmt = (value: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value / 100);

  async function openPortal() {
    setBusy('portal');
    try {
      const { url } = await apiGet<{ url: string }>(`/api/v1/stripe/portal?locale=${locale}`);
      window.location.href = url;
    } catch (error) {
      toast.error(
        error instanceof ApiError && error.status === 404
          ? t('no_billing_account')
          : t('portal_failed'),
      );
    } finally {
      setBusy(null);
    }
  }

  async function toggleCancellation() {
    const cancel = !subscription?.cancelAtPeriodEnd;
    setBusy('cancel');
    try {
      const result = await apiPost<{ cancelAtPeriodEnd: boolean }>('/api/v1/billing/cancel', {
        cancel,
      });
      toast.success(result.cancelAtPeriodEnd ? t('cancel_success') : t('resume_success'));
      onChanged();
    } catch {
      toast.error(t('cancel_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function keepCurrentPlan() {
    setBusy('keep');
    try {
      const result = await apiPost<{ released: boolean }>(
        '/api/v1/billing/release-scheduled-plan',
        {},
      );
      if (result.released) {
        toast.success(t('keep_current_plan_success'));
      } else {
        // No provider schedule to release (an unpaid upgrade waiting for
        // payment). Refresh anyway: the webhook may already have cleared it.
        toast.info(t('keep_current_plan_none'));
      }
      onChanged();
    } catch {
      toast.error(t('keep_current_plan_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function changePlan(planKey: string) {
    setBusy(planKey);
    try {
      const result = await apiPost<ChangePlanResult>('/api/v1/billing/change-plan', { planKey });
      const feedback = planChangeFeedback(result);

      setPendingInvoiceUrl(feedback.hostedInvoiceUrl);
      if (feedback.tone === 'success') toast.success(t(feedback.messageKey));
      else toast.info(t(feedback.messageKey));

      onChanged();
      if (result.status === 'applied') {
        // The entitlement moves on `customer.subscription.updated`, which may
        // arrive just after the Stripe call; refresh once more so the plan card
        // does not keep contradicting the subscription card.
        refreshTimer.current = setTimeout(onChanged, APPLIED_REFRESH_MS);
      }
    } catch {
      toast.error(t('change_plan_failed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('plan_change_title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t('status_label')}</span>
          <span className="font-medium">{statusLabel}</span>
        </div>

        {period && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t(period.labelKey)}</span>
            <span className="font-medium">
              {t(period.messageKey, { date: formatDate(period.date, locale) })}
            </span>
          </div>
        )}

        {subscription.pendingPlanKey && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {t('pending_change', { plan: planName(subscription.pendingPlanKey) })}
            </p>
            {subscription.canChangePlan && (
              <Button
                variant="outline"
                size="sm"
                onClick={keepCurrentPlan}
                disabled={busy !== null}
              >
                {busy === 'keep' ? (
                  <Loader2 className="size-3.5 mr-2 animate-spin" />
                ) : (
                  <Undo2 className="size-3.5 mr-2" />
                )}
                {t('keep_current_plan')}
              </Button>
            )}
          </div>
        )}

        {pendingInvoiceUrl && (
          <a
            href={pendingInvoiceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            {t('change_plan_pending_link')}
            <ExternalLink className="size-3" />
          </a>
        )}

        {invoiceHref(subscription.hostedInvoiceUrl) && (
          <a
            href={invoiceHref(subscription.hostedInvoiceUrl) ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            {t('invoice_link')}
            <ExternalLink className="size-3" />
          </a>
        )}

        {!actions && (
          <p className="text-sm text-muted-foreground">{t(noActionsMessageKey(subscription))}</p>
        )}

        {actions && <Separator />}

        <div className="flex flex-wrap gap-2">
          {subscription.canManagePortal && (
            <Button variant="outline" onClick={openPortal} disabled={busy !== null}>
              {busy === 'portal' ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <CreditCard className="size-4 mr-2" />
              )}
              {t('manage_payments')}
            </Button>
          )}

          {subscription.canCancel && (
            <Button
              variant="outline"
              onClick={toggleCancellation}
              disabled={busy !== null}
              aria-label={
                subscription.cancelAtPeriodEnd ? t('resume_subscription') : t('cancel_subscription')
              }
            >
              {busy === 'cancel' ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : subscription.cancelAtPeriodEnd ? (
                <RefreshCw className="size-4 mr-2" />
              ) : (
                <XCircle className="size-4 mr-2" />
              )}
              {subscription.cancelAtPeriodEnd ? t('resume_subscription') : t('cancel_subscription')}
            </Button>
          )}
        </div>

        {subscription.canChangePlan && alternatives.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('change_plan')}</p>
              <div className="flex flex-wrap gap-2">
                {alternatives.map((plan) => (
                  <Button
                    key={plan.key}
                    variant="secondary"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => changePlan(plan.key)}
                  >
                    {busy === plan.key && <Loader2 className="size-3.5 mr-2 animate-spin" />}
                    {plan.name} · {fmt(plan.priceMonthly, plan.currency)}
                  </Button>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
