'use client';

import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@studiq/ui';
import { useCommandState } from 'cmdk';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LocaleFlag } from '@/components/shared/language-switcher/locale-flag';
import { useLocaleSwitcher } from '@/hooks/use-locale-switcher';
import { LANGUAGE_OPTIONS, type Locale, languageOption } from '@/lib/locale';
import { cn } from '@/lib/utils';

export type LanguageSwitcherPanelProps = {
  /** Called after a selection (including the already-active locale) so the container can close. */
  onDismiss: () => void;
  /** Default true; `false` when the panel is expanded inline in the mobile sheet. */
  autoFocus?: boolean;
  /** Extra classes for the scrollable list. */
  className?: string;
};

type ActiveDescendantSyncProps = {
  inputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  locale: Locale;
};

/**
 * Keeps the combobox's `aria-activedescendant` pointing at the highlighted
 * option.
 *
 * cmdk 1.1.1 owns the attribute (`CommandInput` renders it from
 * `state.selectedItemId`) but only fills `selectedItemId` from a deferred
 * lookup of `[cmdk-item][aria-selected="true"]` that can run before the DOM
 * reflects the new highlight — so on open it stays `undefined` and React never
 * writes *or removes* the attribute, and after filtering it can keep pointing
 * at an option that no longer exists (a dangling IDREF, invalid ARIA).
 *
 * Subscribing to cmdk's public highlight state (`useCommandState`) re-renders
 * this component on every `emit()` — open/auto-select, typing/filtering,
 * pointer hover and arrow/Home/End — so the layout effect below runs after the
 * commit in which `aria-selected` is already correct and the DOM read is
 * authoritative. No timers, no guessing.
 *
 * Must be rendered **inside** `Command`: `useCommandState` reads cmdk's store
 * context, which only exists below `<Command>`. Coupled to cmdk 1.1.1 — revisit
 * on upgrade.
 */
function ActiveDescendantSync({ inputRef, query, locale }: ActiveDescendantSyncProps) {
  // Only the change of the highlighted value matters; it re-renders us.
  const activeValue = useCommandState((state) => state.value);

  useLayoutEffect(() => {
    const input = inputRef.current;
    const root = input?.closest('[cmdk-root]');

    if (!input || !root) return;

    const active = root.querySelector<HTMLElement>('[cmdk-item][aria-selected="true"]');

    if (!active) {
      // Empty state (no match) — never leave a dangling IDREF behind.
      input.removeAttribute('aria-activedescendant');
      return;
    }

    if (input.getAttribute('aria-activedescendant') !== active.id) {
      input.setAttribute('aria-activedescendant', active.id);
    }
  }, [activeValue, query, locale, inputRef]);

  return null;
}

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
      <ActiveDescendantSync inputRef={inputRef} query={query} locale={locale} />
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
