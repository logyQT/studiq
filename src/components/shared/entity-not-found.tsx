'use client';

import { FileX, Home } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type Props = {
  titleKey: string;
  descriptionKey: string;
};

export function EntityNotFound({ titleKey, descriptionKey }: Props) {
  const t = useTranslations('EntityNotFound');

  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="flex flex-col items-center text-center py-12 gap-4">
        <FileX className="h-12 w-12 text-muted-foreground/50" />
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">{t(titleKey)}</h3>
          <p className="text-sm text-muted-foreground">{t(descriptionKey)}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/app">
            <Home className="h-4 w-4 mr-1.5" />
            {t('go_dashboard')}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
