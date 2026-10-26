'use client';

import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@studiq/ui';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LocaleFlag } from '@/components/shared/language-switcher/locale-flag';
import { useLocaleSwitcher } from '@/hooks/use-locale-switcher';
import { LANGUAGE_OPTIONS, languageOption } from '@/lib/locale';
import { cn } from '@/lib/utils';

export type LanguageSwitcherPanelProps = {
  /** Called after a selection (including the already-active locale) so the container can close. */
  onDismiss: () => void;
  /** Default true; `false` when the panel is expanded inline in the mobile sheet. */
  autoFocus?: boolean;
  /** Extra classes for the scrollable list. */
  className?: string;
};

/**
 * The one shared "inside" of every language switcher surface (#634).
 *
 * cmdk owns the combobox semantics (`role=combobox` on the input with
 * `aria-activedescendant`, `role=listbox`, `role=option` + `aria-selected` on
 * the highlighted option) and the fuzzy filter over `value` + `keywords`.
 * Two consequences are deliberate:
 *
 * - The options are rendered **current-first** and no `value` is passed to
 *   `Command`: that lets cmdk auto-highlight the current locale on open, so
 *   Enter with no typing cannot switch the language by accident.
 * - `aria-selected` follows the *highlight*, not the chosen locale, so the
 *   current locale is marked by the check icon + an sr-only word +
 *   `data-current`.
 *
 * The empty state is a sibling of the list, not a child: a `<button>` inside
 * `role=listbox` would be invalid ARIA.
 */
export function LanguageSwitcherPanel({
  onDismiss,
  autoFocus = true,
  className,
}: LanguageSwitcherPanelProps) {
  const t = useTranslations('LanguageSwitcher');
  const { locale, switchTo } = useLocaleSwitcher();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const options = useMemo(() => {
    const current = languageOption(locale);
    return [current, ...LANGUAGE_OPTIONS.filter((option) => option.code !== locale)];
  }, [locale]);

  /**
   * cmdk 1.1.1 leaves `aria-activedescendant` unset until the *first value
   * change*: its auto-highlight runs before the options' `aria-selected` lands,
   * so the lookup that fills `selectedItemId` finds nothing (verified in dev and
   * production builds). The current option is highlighted and Enter is still a
   * no-op, but a screen reader would not hear which option is active on open.
   * Sync it on open (and after clearing the query); from the first arrow key or
   * keystroke cmdk owns the attribute again, so this only runs with no query.
   */
  useEffect(() => {
    if (query !== '') return;

    let frame = 0;
    let cancelled = false;
    let attempts = 0;

    const syncActiveDescendant = () => {
      if (cancelled) return;

      const input = inputRef.current;
      const activeItem = input
        ?.closest('[cmdk-root]')
        ?.querySelector<HTMLElement>('[cmdk-item][aria-selected="true"]');

      if (input && activeItem) {
        if (input.getAttribute('aria-activedescendant') !== activeItem.id) {
          input.setAttribute('aria-activedescendant', activeItem.id);
        }
        return;
      }

      // cmdk sets `aria-selected` a commit later; retry for a few frames.
      if (attempts++ < 10) frame = requestAnimationFrame(syncActiveDescendant);
    };

    frame = requestAnimationFrame(syncActiveDescendant);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [options, query]);

  return (
    <Command label={t('search_label')}>
      <CommandInput
        ref={inputRef}
        value={query}
        onValueChange={setQuery}
        autoFocus={autoFocus}
        placeholder={t('search_placeholder')}
        className="rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
      />
      <CommandList label={t('label')} className={cn('max-h-64 p-1', className)}>
        {options.map((option) => {
          const isCurrent = option.code === locale;

          return (
            <CommandItem
              key={option.code}
              // The endonym is stable and unique — the localized name changes with the locale.
              value={option.endonym}
              keywords={[option.code, ...Object.values(option.names), ...option.aliases]}
              onSelect={() => {
                switchTo(option.code);
                onDismiss();
              }}
              data-current={isCurrent || undefined}
              className="gap-2 px-2 py-1.5 data-[selected=true]:ring-1 data-[selected=true]:ring-inset data-[selected=true]:ring-ring/50"
            >
              <LocaleFlag locale={option.code} />
              <span>{option.endonym}</span>
              {isCurrent && (
                <>
                  <Check aria-hidden="true" className="ml-auto size-4 text-primary" />
                  <span className="sr-only">{t('current')}</span>
                </>
              )}
            </CommandItem>
          );
        })}
      </CommandList>
      <CommandEmpty className="px-3 py-6 text-center text-sm">
        <p role="status" className="font-medium">
          {t('empty_title')}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{t('empty_hint')}</p>
        <button
          type="button"
          onClick={() => {
            setQuery('');
            inputRef.current?.focus();
          }}
          className="mt-3 rounded-sm px-2 py-1 text-sm underline underline-offset-2 transition-colors outline-hidden hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('empty_clear')}
        </button>
      </CommandEmpty>
    </Command>
  );
}
