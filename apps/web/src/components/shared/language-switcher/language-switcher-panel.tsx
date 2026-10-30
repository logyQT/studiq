'use client';

import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@studiq/ui';
import { useCommandState } from 'cmdk';
import { Check, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LanguageOptionLabel } from '@/components/shared/language-switcher/language-option-label';
import { useLocaleSwitcher } from '@/hooks/use-locale-switcher';
import { languageFilter } from '@/lib/language-filter';
import { LANGUAGE_OPTIONS, type Locale, languageOption } from '@/lib/locale';
import { cn } from '@/lib/utils';

export type LanguageSwitcherPanelProps = {
  /** Called after a selection (including the already-active locale) so the container can close. */
  onDismiss: () => void;
  /** Default true; `false` when the panel is expanded inline in the mobile sheet. */
  autoFocus?: boolean;
  /** Extra classes for the scrollable list. */
  className?: string;
  /**
   * Mobile drawer view: the panel fills its container, the list scrolls inside
   * it, rows get touch-sized, and the list opts out of the drawer's
   * swipe-to-close (`data-vaul-no-drag`) so a swipe scrolls instead of closing.
   */
  fill?: boolean;
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
 * The empty state is a sibling of the list, not a child (only options may live
 * inside `role=listbox`); clearing the query is the ✕ inside the search field.
 */
export function LanguageSwitcherPanel({
  onDismiss,
  autoFocus = true,
  className,
  fill,
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
    <Command
      label={t('search_label')}
      filter={languageFilter}
      className={cn('bg-transparent', fill && 'h-full')}
    >
      {/* Filled, rounded search field (system search-bar style); focus is a soft ring on the whole field. */}
      <div
        className={cn(
          'relative p-1.5',
          fill && 'px-0 pt-0 pb-2',
          '[&_[data-slot=command-input-wrapper]]:h-9 [&_[data-slot=command-input-wrapper]]:gap-2 [&_[data-slot=command-input-wrapper]]:rounded-lg [&_[data-slot=command-input-wrapper]]:border [&_[data-slot=command-input-wrapper]]:border-transparent [&_[data-slot=command-input-wrapper]]:bg-muted [&_[data-slot=command-input-wrapper]]:px-3 [&_[data-slot=command-input-wrapper]]:transition-[border-color,box-shadow]',
          '[&_[data-slot=command-input-wrapper]:focus-within]:border-ring/60 [&_[data-slot=command-input-wrapper]:focus-within]:ring-[3px] [&_[data-slot=command-input-wrapper]:focus-within]:ring-ring/20',
          fill &&
            '[&_[data-slot=command-input-wrapper]]:h-11 [&_[data-slot=command-input-wrapper]]:rounded-xl',
        )}
      >
        <CommandInput
          ref={inputRef}
          value={query}
          onValueChange={setQuery}
          autoFocus={autoFocus}
          placeholder={t('search_placeholder')}
          className={cn('h-full py-0 pr-7 focus-visible:ring-0', fill && 'text-base')}
        />
        {query && (
          <button
            type="button"
            aria-label={t('empty_clear')}
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            className={cn(
              'absolute top-1/2 right-3.5 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-background/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
              fill && 'right-2 -mt-1 size-8',
            )}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>
      <CommandList
        label={t('label')}
        data-vaul-no-drag={fill || undefined}
        className={cn(
          'max-h-72 px-1.5 pb-1.5',
          fill && 'max-h-none flex-1 overscroll-contain px-0 pb-0',
          className,
        )}
      >
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
              className={cn(
                'gap-3 rounded-md px-2.5 py-2',
                // Touch: the check marks the current language; the keyboard highlight
                // would double it, so show a press state instead.
                fill &&
                  'rounded-lg px-3 py-3 text-base data-[selected=true]:bg-transparent data-[selected=true]:text-foreground active:bg-accent',
              )}
            >
              <LanguageOptionLabel option={option} uiLocale={locale} withLocalizedName />
              {isCurrent && (
                <>
                  <Check aria-hidden="true" className="ml-auto size-4 shrink-0 text-primary" />
                  <span className="sr-only">{t('current')}</span>
                </>
              )}
            </CommandItem>
          );
        })}
      </CommandList>
      <ActiveDescendantSync inputRef={inputRef} query={query} locale={locale} />
      <CommandEmpty className="px-3 py-8 text-center text-sm">
        <p role="status" className="font-medium">
          {t('empty_title')}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{t('empty_hint')}</p>
      </CommandEmpty>
    </Command>
  );
}
