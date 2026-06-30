'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { apiPost } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { Loader2, Check, CreditCard, Lock } from 'lucide-react';
import { toast } from 'sonner';

const PLAN_INFO: Record<string, { name: string; price: string; period: string; seats: string | null }> = {
  teacher_license: { name: 'Teacher License', price: '29.99', period: '/month', seats: 'Up to 50 student seats' },
  student_premium: { name: 'Student Premium', price: '9.99', period: '/month', seats: null },
};

const PLAN_IDS = ['student_premium', 'teacher_license'];

function CheckoutContent() {
  const t = useTranslations('CheckoutPage');
  const searchParams = useSearchParams();
  const router = useRouter();
  const planId = searchParams.get('plan_id');
  const plan = planId ? PLAN_INFO[planId] : null;

  const { user } = useAuth();
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

  function formatCardNumber(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 16);
    return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
  }

  function formatExpiry(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 4);
    if (digits.length > 2) return digits.slice(0, 2) + '/' + digits.slice(2);
    return digits;
  }

  useEffect(() => {
    if (!planId || !PLAN_IDS.includes(planId)) {
      router.push('/pricing');
    }
  }, [planId, router]);

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
      toast.error(t('payment_failed'));
    } finally {
      setIsProcessing(false);
    }
  }

  if (!plan) return null;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <div className="w-full max-w-4xl grid md:grid-cols-5 gap-6">
        {/* Order summary */}
        <Card className="md:col-span-2 md:order-2">
          <CardHeader>
            <CardTitle className="text-base">{t('summary')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{plan.name}</span>
              <span className="font-medium">${plan.price}{plan.period}</span>
            </div>
            {plan.seats && (
              <div className="text-xs text-muted-foreground">{plan.seats}</div>
            )}
            <Separator />
            <div className="flex justify-between text-sm font-medium">
              <span>{t('total')}</span>
              <span>${plan.price}{plan.period}</span>
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
                <CardTitle>{t('title')}</CardTitle>
                <CardDescription>{t('description', { plan: plan.name })}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cardNumber">{t('card_number')}</Label>
                <div className="relative">
                  <Input
                    id="cardNumber"
                    placeholder="4242 4242 4242 4242"
                    value={cardNumber}
                    onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                    className="pr-10 font-mono"
                    disabled={isProcessing || isDone}
                  />
                  {isCardValid && <Check className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-green-500" />}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="expiry">{t('expiry')}</Label>
                  <Input id="expiry" placeholder="MM/YY" value={expiry} onChange={(e) => setExpiry(formatExpiry(e.target.value))} className="font-mono" disabled={isProcessing || isDone} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cvc">{t('cvc')}</Label>
                  <Input id="cvc" placeholder="123" value={cvc} onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 3))} className="font-mono" disabled={isProcessing || isDone} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cardName">{t('card_name')}</Label>
                <Input id="cardName" placeholder="John Doe" value={cardName} onChange={(e) => setCardName(e.target.value)} disabled={isProcessing || isDone} />
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2">
                <Lock className="size-3" />
                <span>{t('secured')}</span>
              </div>

              {isDone ? (
                <div className="flex items-center justify-center gap-2 text-green-600 font-medium py-3">
                  <Check className="size-5" />
                  {t('success')}
                </div>
              ) : (
                <Button type="submit" className="w-full" disabled={!canSubmit || isProcessing}>
                  {isProcessing && <Loader2 className="size-4 mr-2 animate-spin" />}
                  {isProcessing ? t('processing') : t('pay', { amount: `$${plan.price}` })}
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
