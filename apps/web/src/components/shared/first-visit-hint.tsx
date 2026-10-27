'use client';

import { Button } from '@studiq/ui';
import { Lightbulb, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { type FirstVisitHintId, hintStorageKey } from '@/lib/first-visit-hint';

interface FirstVisitHintProps {
  /** Which page's tip this is: its text is `EmptyStates.hint_<id>`, its dismissal is remembered per id. */
  id: FirstVisitHintId;
  className?: string;
}

/**
 * A one-time tip on the first visit to a list page (#666). Dismissing it is remembered in
 * `localStorage`; where storage is unavailable (private window, blocked site data) the tip simply
 * shows again next time. Rendered only after mount, so the server and the first client render
 * agree and a dismissed tip never flashes.
 */
export function FirstVisitHint({ id, className }: FirstVisitHintProps) {
  const t = useTranslations('EmptyStates');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(localStorage.getItem(hintStorageKey(id)) !== '1');
    } catch {
      setVisible(true);
    }
  }, [id]);

  if (!visible) return null;

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(hintStorageKey(id), '1');
    } catch {
      /* storage unavailable: the tip comes back next visit */
    }
  }

  return (
    <div
      role="note"
      className={`flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm ${className ?? ''}`}
    >
      <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      <p className="flex-1">{t(`hint_${id}`)}</p>
      <Button
        variant="ghost"
        size="icon"
        className="-m-1 size-7 shrink-0"
        onClick={dismiss}
        aria-label={t('hint_dismiss')}
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
