'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@studiq/ui';
import { useTranslations } from 'next-intl';
import { LanguageOptionLabel } from '@/components/shared/language-switcher/language-option-label';
import { useLocaleSwitcher } from '@/hooks/use-locale-switcher';
import { isSupportedLocale, LANGUAGE_OPTIONS } from '@/lib/locale';
import { cn } from '@/lib/utils';

export type LanguageSelectProps = {
  /**
   * `ghost` — borderless, for a row inside a menu (reads as part of the row);
   * `outline` — a standalone control (footer).
   */
  variant?: 'ghost' | 'outline';
  className?: string;
};

/**
 * Desktop language control (#634): a plain select, no search field. Choosing
 * an option switches immediately. Touch surfaces use the searchable panel
 * instead.
 */
export function LanguageSelect({ variant = 'ghost', className }: LanguageSelectProps) {
  const t = useTranslations('LanguageSwitcher');
  const { locale, option, switchTo } = useLocaleSwitcher();

  return (
    <Select
      value={locale}
      onValueChange={(value) => {
        if (isSupportedLocale(value)) switchTo(value);
      }}
    >
      <SelectTrigger
        // Name + value, so a screen reader hears "Język: Polski" on the trigger.
        aria-label={`${t('label')}: ${option.endonym}`}
        className={cn(
          'w-auto gap-1.5 text-sm font-normal shadow-none transition-colors',
          variant === 'ghost' &&
            'h-8 border-transparent bg-transparent px-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground dark:bg-transparent dark:hover:bg-accent',
          variant === 'outline' && 'h-9 px-3',
          className,
        )}
      >
        {/* Custom value: the trigger shows flag + endonym only, not the list's secondary name. */}
        <SelectValue>
          <LanguageOptionLabel option={option} uiLocale={locale} className="gap-2" />
        </SelectValue>
      </SelectTrigger>
      {/* Opens under the trigger and flips above when there's no room — the
          whole list is always visible (item-aligned clipped near the screen edge). */}
      <SelectContent
        position="popper"
        side="bottom"
        align="end"
        sideOffset={6}
        className="min-w-56"
      >
        {LANGUAGE_OPTIONS.map((item) => (
          <SelectItem key={item.code} value={item.code} className="py-2 pr-8 pl-2.5">
            <LanguageOptionLabel option={item} uiLocale={locale} withLocalizedName />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
