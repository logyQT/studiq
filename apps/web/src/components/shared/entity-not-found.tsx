'use client';

import { Button, Card, CardContent } from '@studiq/ui';
import { FileX, Home, Layers } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/components/providers/AuthProvider';
import { dashboardHomeFor } from '@/lib/dashboard-home';

type Props = {
  titleKey: string;
  descriptionKey: string;
  /**
   * Recovery destination for screens that own a content root (e.g. a deck
   * screen's list). `label` must already be translated by the caller, which
   * owns the copy for its own area.
   */
  fallback?: { href: string; label: string };
};

export function EntityNotFound({ titleKey, descriptionKey, fallback }: Props) {
  const t = useTranslations('EntityNotFound');
  const { user } = useAuth();
  const href = fallback?.href ?? dashboardHomeFor(user?.app_metadata?.account_type);
  const RecoveryIcon = fallback ? Layers : Home;

  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="flex flex-col items-center text-center py-12 gap-4">
        <FileX className="h-12 w-12 text-muted-foreground/50" />
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">{t(titleKey)}</h3>
          <p className="text-sm text-muted-foreground">{t(descriptionKey)}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={href}>
            <RecoveryIcon className="h-4 w-4 mr-1.5" />
            {fallback ? fallback.label : t('go_dashboard')}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
