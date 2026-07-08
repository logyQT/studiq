'use client';

import { Check, CreditCard, Loader2, Lock, Minus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { apiGet, apiPost } from '@/lib/api';
import type { PlanInfo } from '@/server/services/subscription-plan.service';

const SORTED_LIMIT_KEYS = [
  'max_flashcards',
  'max_decks',
  'max_questions',
  'max_question_banks',
  'max_quiz_attempts_per_day',
  'max_ai_tokens_per_day',
  'max_students',
  'max_groups',
  'max_storage_mb',
];

function CheckoutContent() {
  const ct = useTranslations('CheckoutPage');
  const pt = useTranslations('PricingPage');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const router = useRouter();
  const planId = searchParams.get('plan_id');
  const { user } = useAuth();

  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [isLoadingPlan, setIsLoadingPlan] = useState(true);
  const [planNotFound, setPlanNotFound] = useState(false);

  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [cardName, setCardName] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDone, setIsDone] = useState(false);

  const isCardValid = cardNumber.replace(/\s/g, '').length === 16 && cardNumber.length > 0;
  const isExpiryValid = expiry.length === 5;
  const isCvcValid = cvc.length === 3;
  const isNameValid = cardName.trim().length > 0;
  const canSubmit = isCardValid && isExpiryValid && isCvcValid && isNameValid;

  useEffect(() => {
    if (!planId) {
      router.push('/pricing');
      return;
    }
    setIsLoadingPlan(true);
    apiGet<PlanInfo>(`/api/v1/subscription-plans/${planId}`)
      .then(setPlan)
      .catch(() => setPlanNotFound(true))
      .finally(() => setIsLoadingPlan(false));
  }, [planId, router]);

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
    setIsProcessing(true);
    try {
      await apiPost('/api/v1/stripe/webhook', {
        type: 'checkout.session.completed',
        session_id: crypto.randomUUID(),
        plan_id: planId,
        user_id: user.id,
      });
      setIsDone(true);
      setTimeout(() => router.push('/billing/success?redirect=auto'), 2000);
    } catch {
      toast.error(ct('payment_failed'));
    } finally {
      setIsProcessing(false);
    }
  }

  if (isLoadingPlan) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (planNotFound || !plan) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Plan not found</p>
        <Button onClick={() => router.push('/pricing')}>Back to plans</Button>
      </div>
    );
  }

  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: plan.currency,
  });
  const displayPrice = formatter.format(plan.priceMonthly / 100);

  function getFeatureLabel(key: string): string {
    const label = pt(`feature_${key}`);
    return label.startsWith('feature_') ? key : label;
  }

  function getLimitLabel(key: string): string {
    const label = pt(`limit_${key}`);
    return label.startsWith('limit_') ? key : label;
  }

  const visibleLimits = SORTED_LIMIT_KEYS.filter((k) => k in plan.limits);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <div className="w-full max-w-4xl grid md:grid-cols-5 gap-6">
        {/* Order summary */}
        <Card className="md:col-span-2 md:order-2">
          <CardHeader>
            <CardTitle className="text-base">{ct('summary')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{plan.name}</span>
              <span className="font-medium">
                {displayPrice}
                {pt('period_month')}
              </span>
            </div>

            {plan.features.length > 0 && (
              <>
                <Separator />
                <ul className="space-y-2">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-2 text-sm">
                      <Check className="size-3.5 shrink-0 text-green-500" />
                      <span>{getFeatureLabel(feature)}</span>
                    </li>
                  ))}
                </ul>
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

        {/* Payment form */}
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
