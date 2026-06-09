'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Construction } from 'lucide-react';

export default function EduFlashcardStatsClient() {
  const t = useTranslations('EduFlashcardStatsPage');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/edu/flashcards">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" /> {t('back')}
          </Button>
        </Link>
        <h2 className="text-2xl font-bold">{t('title')}</h2>
      </div>

      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Construction className="h-16 w-16 text-muted-foreground mb-6" />
        <h3 className="text-xl font-semibold">{t('coming_soon_title')}</h3>
        <p className="text-muted-foreground mt-2 max-w-md">{t('coming_soon_desc')}</p>
      </div>
    </div>
  );
}
