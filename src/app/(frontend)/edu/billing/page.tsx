'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { apiGet } from '@/lib/api';
import { Check, CreditCard, Users } from 'lucide-react';

export default function EduBillingPage() {
  const t = useTranslations('BillingPage');
  const router = useRouter();
  const [studentCount, setStudentCount] = useState(0);

  useEffect(() => {
    apiGet<{ role: string }[]>('/api/v1/organization/members')
      .then((d) => setStudentCount(d.filter((m) => m.role === 'student').length))
      .catch(() => {});
  }, []);

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
              <CardDescription>{t('classroom_plan')}</CardDescription>
            </div>
            <Badge className="text-sm px-3 py-1">{t('active')}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold">$29.99</span>
            <span className="text-muted-foreground">/month</span>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Users className="size-4 text-muted-foreground" />
            <span>{t('seats_used', { used: studentCount, total: 50 })}</span>
          </div>

          <Separator />

          <ul className="space-y-2">
            {['feature_1', 'feature_2', 'feature_3', 'feature_4', 'feature_5'].map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm">
                <Check className="size-4 text-primary shrink-0" />
                <span>{t(f)}</span>
              </li>
            ))}
          </ul>

          <div className="flex gap-3 pt-2">
            <Button onClick={() => router.push('/checkout?plan_id=teacher_license')}>
              <CreditCard className="size-4 mr-2" />
              {t('manage_subscription')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
