'use client';

import { Check, School, Sparkles, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/components/providers/AuthProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

export default function AppBillingPage() {
  const t = useTranslations('BillingPage');
  const router = useRouter();
  const { user } = useAuth();
  const role = user?.app_metadata?.role as string;
  const isPremium = role === 'premium';
  const _isFree = role === 'free' || role === 'student';

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t('current_plan')}</CardTitle>
              <CardDescription>{isPremium ? t('premium_plan') : t('free_plan')}</CardDescription>
            </div>
            <Badge variant={isPremium ? 'default' : 'secondary'}>
              {isPremium ? t('active') : t('free')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold">{isPremium ? '$9.99' : '$0'}</span>
            <span className="text-muted-foreground">
              {isPremium ? '/month' : t('free_forever')}
            </span>
          </div>

          {role === 'student' && (
            <div className="flex items-center gap-2 rounded-lg bg-muted p-3 text-sm">
              <School className="size-4 text-muted-foreground shrink-0" />
              <span>{t('access_via_classroom')}</span>
            </div>
          )}

          <Separator />

          <ul className="space-y-2">
            {(isPremium
              ? ['p_feature_1', 'p_feature_2', 'p_feature_3', 'p_feature_4']
              : ['f_feature_1', 'f_feature_2']
            ).map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm">
                {isPremium || f === 'f_feature_1' || f === 'f_feature_2' ? (
                  <Check className="size-4 text-primary shrink-0" />
                ) : (
                  <X className="size-4 text-muted-foreground shrink-0" />
                )}
                <span>{t(f)}</span>
              </li>
            ))}
          </ul>

          {!isPremium && (
            <Button
              className="w-full"
              onClick={() => router.push('/checkout?plan_id=student_premium')}
            >
              <Sparkles className="size-4 mr-2" />
              {t('upgrade')}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
