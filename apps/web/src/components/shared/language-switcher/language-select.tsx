'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@studiq/ui';
import { useTranslations } from 'next-intl';
import { LanguageOptionLabel } from '@/components/shared/language-switcher/language-option-label';
import {
  CONTROL_FOCUS,
  CONTROL_RADIUS,
  PANEL_RADIUS,
  PREFERENCE_GEOMETRY,
  TRIGGER_CHROME,
} from '@/components/shared/preference-controls';
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
 *
 * The trigger's shape comes from the call site, not from the kit: the outline
 * variant is the same quiet control as the footer's mobile trigger
 * (`TRIGGER_CHROME`), and the chevron keeps `muted-foreground` at full opacity
 * instead of the kit's `opacity-50`.
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
        // `sm` supplies the kit's 32px height; the call site still owns the shape.
        size="sm"
        // Name + value, so a screen reader hears "Język: Polski" on the trigger.
        aria-label={`${t('label')}: ${option.endonym}`}
        // The user menu renders this inline; keep the menu's roving focus and
        // typeahead from also handling keys meant for the select (arrows open
        // the listbox, printable keys would jump focus to a matching menu item).
        onKeyDown={(event) => {
          const isModified = event.ctrlKey || event.metaKey || event.altKey;
          const isPrintable = event.key.length === 1;
          if (
            event.key === 'ArrowUp' ||
            event.key === 'ArrowDown' ||
            (isPrintable && !isModified)
          ) {
            event.stopPropagation();
          }
        }}
        className={cn(
          'font-normal shadow-none [&>svg]:opacity-100',
          variant === 'outline' &&
            cn(
              TRIGGER_CHROME,
              CONTROL_RADIUS,
              // 32px: the same box as the theme group beside it
              // (`PREFERENCE_GEOMETRY.compact`). The 44px trigger is the touch
              // surface (mobile), where the theme group grows to match.
              `${PREFERENCE_GEOMETRY.compact} justify-between dark:bg-background dark:hover:bg-secondary`,
            ),
          variant === 'ghost' &&
            cn(
              'h-8 border-transparent bg-transparent px-2 text-sm text-muted-foreground transition-colors',
              CONTROL_RADIUS,
              'hover:bg-accent hover:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground dark:bg-transparent dark:hover:bg-accent',
              CONTROL_FOCUS,
            ),
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
        className={cn('min-w-56 border-border bg-background shadow-none', PANEL_RADIUS)}
      >
        {LANGUAGE_OPTIONS.map((item) => (
          <SelectItem
            key={item.code}
            value={item.code}
            className={cn('py-2 pr-8 pl-2.5', CONTROL_RADIUS)}
          >
            <LanguageOptionLabel option={item} uiLocale={locale} withLocalizedName />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
