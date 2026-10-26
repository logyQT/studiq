'use client';

import { Button, Popover, PopoverTrigger } from '@studiq/ui';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { LanguageSwitcherContent } from '@/components/shared/language-switcher/language-switcher-content';
import { LocaleFlag } from '@/components/shared/language-switcher/locale-flag';
import { useLocaleSwitcher } from '@/hooks/use-locale-switcher';

/**
 * Footer surface of the language switcher (#634): a labelled outline button
 * (flag + endonym + chevron) that opens the shared panel upwards. The visible
 * endonym is part of the accessible name, so the control is never flag-only.
 */
export function LanguageSwitcher() {
  const t = useTranslations('LanguageSwitcher');
  const { locale, option } = useLocaleSwitcher();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-9 gap-2 px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LocaleFlag locale={locale} />
          <span className="sr-only">{t('label')}: </span>
          {option.endonym}
          <ChevronDown aria-hidden="true" className="size-4 opacity-60" />
        </Button>
      </PopoverTrigger>
      <LanguageSwitcherContent side="top" align="end" onDismiss={() => setOpen(false)} />
    </Popover>
  );
}
