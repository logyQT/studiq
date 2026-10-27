'use client';

import { Button } from '@studiq/ui';
import { Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * Plan gate for the AI page (#375): rendered when the account's feature set has
 * no `ai.chat`. The sidebar already hides the entry for the same feature, so a
 * direct URL must not fall through to a composer the API rejects with a 429.
 *
 * Mirrors `BrandingLockedCard` (manage/settings): dashed card, `Lock` icon and
 * the pricing page as the only action.
 */
export function AiChatLockedState() {
  const t = useTranslations('AiChatPage');
  const router = useRouter();

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <div className="flex max-w-md flex-col items-center gap-3 rounded-md border border-dashed bg-muted/40 p-6 text-center">
        <Lock className="size-6 text-muted-foreground" />
        <p className="text-base font-medium">{t('locked_title')}</p>
        <p className="text-sm text-muted-foreground">{t('locked_desc')}</p>
        <Button variant="outline" onClick={() => router.push('/pricing')}>
          {t('locked_cta')}
        </Button>
      </div>
    </div>
  );
}
