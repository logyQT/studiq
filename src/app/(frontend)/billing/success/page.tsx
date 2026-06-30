'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, ArrowRight } from 'lucide-react';

export default function BillingSuccessPage() {
  const t = useTranslations('BillingSuccessPage');
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => router.push('/app'), 3000);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mx-auto rounded-full bg-green-100 dark:bg-green-900/30 p-3 w-fit mb-4">
            <CheckCircle className="size-10 text-green-600" />
          </div>
          <CardTitle className="text-2xl">{t('title')}</CardTitle>
          <p className="text-muted-foreground mt-2">{t('description')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('redirecting')}</p>
          <Button className="w-full" onClick={() => router.push('/app')}>
            {t('go_dashboard')} <ArrowRight className="size-4 ml-2" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
