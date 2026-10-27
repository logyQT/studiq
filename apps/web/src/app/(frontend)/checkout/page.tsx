'use client';

import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  OrgAvatar,
  Separator,
} from '@studiq/ui';
import { AlertCircle, Check, CreditCard, Loader2, Lock, Minus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/components/providers/AuthProvider';
import { useApiQuery } from '@/hooks/use-api';
import { apiPost, ApiError } from '@/lib/api';
import { resolveCheckoutOrg, type CheckoutOrg, type OrgsStatus } from '@/lib/checkout-org';
import { getHighlightedFeatures, sortFeaturesByPriority } from '@/lib/pricing-benefits';
import { getFeatureLabel as getFeatureLabelShared } from '@/lib/pricing-features';

const SORTED_LIMIT_KEYS = [
  'max_flashcards',
  'max_decks',
  'max_questions',
  'max_question_banks',
  'max_quiz_attempts_per_day',
  'max_ai_tokens_per_day',
  'max_students',
  'max_groups',
];

const HIGHLIGHTED_FEATURES = 5;

function FullPageSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function CheckoutContent() {
  const ct = useTranslations('CheckoutPage');
  const pt = useTranslations('PricingPage');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const router = useRouter();
  const planId = searchParams.get('plan_id')?.trim() || null;
  const orgId = searchParams.get('org_id')?.trim() || null;
  const { user, isLoading: isAuthLoading } = useAuth();

  const [showAllBenefits, setShowAllBenefits] = useState(false);

  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [cardName, setCardName] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDone, setIsDone] = useState(false);

  const planQuery = useApiQuery<PlanInfo>({
    queryKey: ['subscription-plans', 'detail', planId],
    url: `/api/v1/subscription-plans/${planId}`,
    enabled: !!planId,
  });
  const plan = planQuery.data;
  const isOrgPlan = plan?.forAccountType === 'manager';

  // The target org comes from the self-scoped membership list (RLS: members
  // only) — never from the URL, which is user-editable and goes stale on a
  // rename. Shared key with the navbar so coming from `/pricing/org` reuses it.
  const orgsQuery = useApiQuery<CheckoutOrg[]>({
    queryKey: ['orgs'],
    url: '/api/v1/me/orgs',
    enabled: !!user && isOrgPlan,
    staleTime: 5 * 60 * 1000,
  });

  // Cached rows win over a failed background refetch: a 5-minute refetch that
  // errors must not turn a working checkout into a blocking error card.
  const orgsStatus: OrgsStatus = orgsQuery.data ? 'ready' : orgsQuery.isError ? 'error' : 'pending';
  const resolution = resolveCheckoutOrg({
    isOrgPlan,
    orgId,
    orgs: orgsQuery.data,
    orgsStatus,
  });

  useEffect(() => {
    if (!planId) router.replace('/pricing');
  }, [planId, router]);

  const isCardValid = cardNumber.replace(/\s/g, '').length === 16 && cardNumber.length > 0;
  const isExpiryValid = expiry.length === 5;
  const isCvcValid = cvc.length === 3;
  const isNameValid = cardName.trim().length > 0;
  const canSubmit = isCardValid && isExpiryValid && isCvcValid && isNameValid;

  function formatCardNumber(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 16);
    return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
  }

  function formatExpiry(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 4);
    if (digits.length > 2) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return digits;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !planId) return;
    if (!user) return;
    // Send the org the UI actually showed. For a personal plan nothing is
    // sent: a stray `org_id` in the URL must not reach the mock webhook.
    const resolvedOrgId = resolution.status === 'ok' ? resolution.org.id : null;
    if (isOrgPlan && !resolvedOrgId) return;
    setIsProcessing(true);
    try {
      await apiPost('/api/v1/stripe/webhook', {
        type: 'checkout.session.completed',
        session_id: crypto.randomUUID(),
        plan_id: planId,
        user_id: user.id,
        ...(resolvedOrgId ? { org_id: resolvedOrgId } : {}),
      });
      setIsDone(true);
      setTimeout(() => router.push('/billing/success?redirect=auto'), 2000);
    } catch {
      toast.error(ct('payment_failed'));
    } finally {
      setIsProcessing(false);
    }
  }

  if (!planId || planQuery.isPending) return <FullPageSpinner />;

  if (planQuery.isError) {
    const notFound = planQuery.error instanceof ApiError && planQuery.error.status === 404;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">
          {notFound ? ct('plan_not_found') : ct('load_error')}
        </p>
        <div className="flex items-center gap-2">
          {!notFound && (
            <Button variant="outline" onClick={() => planQuery.refetch()}>
              {ct('retry')}
            </Button>
          )}
          <Button onClick={() => router.push('/pricing')}>{ct('back_to_plans')}</Button>
        </div>
      </div>
    );
  }

  if (!plan) return <FullPageSpinner />;

  // `requireAuth` on `/checkout` makes this unreachable in practice; fail
  // closed instead of rendering a form that cannot be submitted.
  if (isAuthLoading) return <FullPageSpinner />;

  if (isOrgPlan && orgId && user && resolution.status === 'loading') {
    return <FullPageSpinner />;
  }

  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: plan.currency,
  });
  const displayPrice = formatter.format(plan.priceMonthly / 100);

  function getFeatureLabel(key: string): string {
    return getFeatureLabelShared(key, pt);
  }

  function getLimitLabel(key: string): string {
    const label = pt(`limit_${key}`);
    return label.startsWith('limit_') ? key : label;
  }

  const visibleLimits = SORTED_LIMIT_KEYS.filter((k) => k in plan.limits);
  const featuredFeatures = getHighlightedFeatures(plan.features, HIGHLIGHTED_FEATURES);
  const allFeatures = sortFeaturesByPriority(plan.features);
  const visibleFeatures = showAllBenefits ? allFeatures : featuredFeatures;
  const hasMoreFeatures = allFeatures.length > featuredFeatures.length;

  const targetOrg =
    resolution.status === 'ok' || resolution.status === 'not-admin' ? resolution.org : null;
  const isDifferentFromActive =
    resolution.status === 'ok' || resolution.status === 'not-admin'
      ? resolution.isDifferentFromActive
      : false;

  const plansUrl = isOrgPlan ? '/pricing/org' : '/pricing';

  let blockedState: {
    title: string;
    description: string;
    retry?: () => void;
  } | null = null;

  if (isOrgPlan && !user) {
    blockedState = {
      title: ct('org_unavailable_title'),
      description: ct('org_unavailable_desc'),
    };
  } else if (resolution.status === 'missing-org-id') {
    blockedState = {
      title: ct('org_missing_title'),
      description: ct('org_missing_desc'),
    };
  } else if (resolution.status === 'load-error') {
    blockedState = {
      title: ct('orgs_load_error'),
      description: ct('org_unavailable_desc'),
      retry: () => orgsQuery.refetch(),
    };
  } else if (resolution.status === 'not-member') {
    blockedState = {
      title: ct('org_unavailable_title'),
      description: ct('org_unavailable_desc'),
    };
  } else if (resolution.status === 'not-admin') {
    blockedState = {
      title: ct('org_not_admin_title'),
      description: ct('org_not_admin_desc', { org: resolution.org.name }),
    };
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <div className="w-full max-w-4xl grid md:grid-cols-5 gap-6">
        {/* Order summary */}
        <Card className="md:col-span-2 md:order-2">
          <CardHeader>
            <CardTitle className="text-base">{ct('summary')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {targetOrg && (
              <>
                <div className="flex items-start gap-3">
                  <OrgAvatar orgId={targetOrg.id} name={targetOrg.name} size={36} />
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {ct('target_org_label')}
                    </p>
                    <p className="font-medium break-words">{targetOrg.name}</p>
                    <p className="text-xs text-muted-foreground">{ct('target_org_hint')}</p>
                    {isDifferentFromActive && (
                      <p className="text-xs text-amber-600">{ct('target_org_not_active')}</p>
                    )}
                  </div>
                </div>
                <Separator />
              </>
            )}

            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{plan.name}</span>
              <span className="font-medium">
                {displayPrice}
                {pt('period_month')}
              </span>
            </div>

            {visibleFeatures.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <p className="text-sm font-medium">{ct('benefits_title')}</p>
                  <ul className="space-y-2">
                    {visibleFeatures.map((feature) => (
                      <li key={feature} className="flex items-center gap-2 text-sm">
                        <Check className="size-3.5 shrink-0 text-green-500" />
                        <span>{getFeatureLabel(feature)}</span>
                      </li>
                    ))}
                  </ul>
                  {hasMoreFeatures && (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={() => setShowAllBenefits((prev) => !prev)}
                    >
                      {showAllBenefits
                        ? ct('benefits_show_less')
                        : ct('benefits_show_all', { count: allFeatures.length })}
                    </Button>
                  )}
                </div>
              </>
            )}

            {visibleLimits.length > 0 && (
              <>
                <Separator />
                <div className="space-y-1.5">
                  {visibleLimits.map((key) => {
                    const value = plan.limits[key];
                    return (
                      <div key={key} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{getLimitLabel(key)}</span>
                        <span className="font-medium tabular-nums">
                          {value === -1 ? (
                            <span className="flex items-center gap-1">
                              <Minus className="size-3" />
                              {pt('limit_unlimited')}
                            </span>
                          ) : (
                            value.toLocaleString(locale)
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <Separator />
            <div className="flex justify-between text-sm font-medium">
              <span>{ct('total')}</span>
              <span>
                {displayPrice}
                {pt('period_month')}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Payment form / blocking state */}
        <Card className="md:col-span-3 md:order-1">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-primary/10 p-2">
                <CreditCard className="size-5 text-primary" />
              </div>
              <div>
                <CardTitle>{ct('title')}</CardTitle>
                <CardDescription>{ct('description', { plan: plan.name })}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {blockedState ? (
              <div className="space-y-4">
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertTitle>{blockedState.title}</AlertTitle>
                  <AlertDescription>{blockedState.description}</AlertDescription>
                </Alert>
                <div className="flex flex-wrap items-center gap-2">
                  {blockedState.retry && (
                    <Button variant="outline" onClick={blockedState.retry}>
                      {ct('retry')}
                    </Button>
                  )}
                  <Button onClick={() => router.push(plansUrl)}>{ct('back_to_plans')}</Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="cardNumber">{ct('card_number')}</Label>
                  <div className="relative">
                    <Input
                      id="cardNumber"
                      placeholder="4242 4242 4242 4242"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                      className="pr-10 font-mono"
                      disabled={isProcessing || isDone}
                    />
                    {isCardValid && (
                      <Check className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-green-500" />
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="expiry">{ct('expiry')}</Label>
                    <Input
                      id="expiry"
                      placeholder="MM/YY"
                      value={expiry}
                      onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                      className="font-mono"
                      disabled={isProcessing || isDone}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cvc">{ct('cvc')}</Label>
                    <Input
                      id="cvc"
                      placeholder="123"
                      value={cvc}
                      onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 3))}
                      className="font-mono"
                      disabled={isProcessing || isDone}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cardName">{ct('card_name')}</Label>
                  <Input
                    id="cardName"
                    placeholder="John Doe"
                    value={cardName}
                    onChange={(e) => setCardName(e.target.value)}
                    disabled={isProcessing || isDone}
                  />
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2">
                  <Lock className="size-3" />
                  <span>{ct('secured')}</span>
                </div>

                {targetOrg && (
                  <p className="text-xs text-muted-foreground">
                    {ct('pay_for_org', { org: targetOrg.name })}
                  </p>
                )}

                {isDone ? (
                  <div className="flex items-center justify-center gap-2 text-green-600 font-medium py-3">
                    <Check className="size-5" />
                    {ct('success')}
                  </div>
                ) : (
                  <Button type="submit" className="w-full" disabled={!canSubmit || isProcessing}>
                    {isProcessing && <Loader2 className="size-4 mr-2 animate-spin" />}
                    {isProcessing
                      ? ct('processing')
                      : ct('pay', { amount: `${displayPrice}${pt('period_month')}` })}
                  </Button>
                )}
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense>
      <CheckoutContent />
    </Suspense>
  );
}
