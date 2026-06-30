'use client';

import { Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ManageBillingPage() {
  const t = useTranslations('BillingPage');

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
              <CardDescription>{t('org_plan')}</CardDescription>
            </div>
            <Badge variant="secondary">{t('basic')}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('org_contact')}</p>
          <Button variant="outline" asChild>
            <a href="mailto:sales@studiq.app">
              <Mail className="size-4 mr-2" />
              {t('contact_sales')}
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
