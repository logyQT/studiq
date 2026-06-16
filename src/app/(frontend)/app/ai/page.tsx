'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { Construction } from 'lucide-react';

export default function AiPage() {
  const t = useTranslations('DashboardLayout');

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="max-w-md w-full">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <Construction className="h-12 w-12 text-muted-foreground" />
          <h2 className="text-xl font-semibold">{t('ai_under_construction')}</h2>
          <p className="text-muted-foreground">{t('ai_under_construction_desc')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
