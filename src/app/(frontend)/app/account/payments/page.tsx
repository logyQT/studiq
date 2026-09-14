'use client';

import { CreditCard } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function AppAccountPaymentsPage() {
  const t = useTranslations('AccountPage');

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('payments_title')}</h1>
        <p className="text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('payments_title')}</CardTitle>
          <CardDescription>{t('no_payments')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/app/billing">
              <CreditCard className="size-4 mr-2" />
              {t('manage_billing')}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
