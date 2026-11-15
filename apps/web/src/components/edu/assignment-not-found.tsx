'use client';

import { Button } from '@studiq/ui';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

/**
 * The terminal state of an assignment route whose id does not resolve.
 *
 * `useApiQuery` leaves `data` undefined on a 404, so a screen that keeps its
 * loading branch on `!assignment` stays on the skeleton for the life of the page
 * (#1225). Every assignment screen renders this instead, and the detail page owns
 * the copy.
 */
export function AssignmentNotFound() {
  const t = useTranslations('EduAssignmentDetailPage');

  return (
    <div className="p-6 text-center space-y-3">
      <p className="text-muted-foreground">{t('not_found')}</p>
      <Button variant="outline" size="sm" asChild>
        <Link href="/edu/assignments">
          <ArrowLeft className="w-4 h-4 mr-1.5" />
          {t('back')}
        </Link>
      </Button>
    </div>
  );
}
