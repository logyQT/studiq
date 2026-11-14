'use client';

import { Popover, PopoverTrigger, useIsMobile } from '@studiq/ui';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { LanguageSelect } from '@/components/shared/language-switcher/language-select';
import { LanguageSwitcherContent } from '@/components/shared/language-switcher/language-switcher-content';
import { LocaleFlag } from '@/components/shared/language-switcher/locale-flag';
import { PREFERENCE_GEOMETRY, TRIGGER_CHROME } from '@/components/shared/preference-controls';
import { useLocaleSwitcher } from '@/hooks/use-locale-switcher';
import { cn } from '@/lib/utils';

/**
 * Footer surface of the language switcher (#634): a labelled outline button
 * (flag + endonym + chevron) that opens the shared panel upwards. The visible
 * endonym is part of the accessible name, so the control is never flag-only.
 *
 * The trigger is a plain button rather than the kit's `Button`: this is a quiet
 * control (outline frame, paper fill, no shadow), and its chrome is shared with
 * the desktop select through `TRIGGER_CHROME`.
 */
export function LanguageSwitcher() {
  const t = useTranslations('LanguageSwitcher');
  const { locale, option } = useLocaleSwitcher();
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  // Desktop: a plain select (no search). Phones: the same list, opened as a
  // popover of 48px rows — no search field, so nothing summons the keyboard.
  if (!isMobile) return <LanguageSelect variant="outline" />;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* 44px: the drawer footer is a touch surface, and the same box the theme
            group resolves to beside it (`PREFERENCE_GEOMETRY.touch`). */}
        <button type="button" className={cn(TRIGGER_CHROME, PREFERENCE_GEOMETRY.touch)}>
          <LocaleFlag locale={locale} />
          <span className="sr-only">{t('label')}: </span>
          <span translate="no" lang={option.code}>
            {option.endonym}
          </span>
          <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <LanguageSwitcherContent side="top" align="end" onDismiss={() => setOpen(false)} />
    </Popover>
  );
}
