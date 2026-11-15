'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { LanguageOptionLabel } from '@/components/shared/language-switcher/language-option-label';
import { CONTROL_FOCUS, CONTROL_RADIUS } from '@/components/shared/preference-controls';
import { useLocaleSwitcher } from '@/hooks/use-locale-switcher';
import { LANGUAGE_OPTIONS } from '@/lib/locale';
import { cn } from '@/lib/utils';

export type LocaleListProps = {
  /** Called after a selection so the container can close. */
  onDismiss: () => void;
};

/**
 * The touch language picker (#634): one 48px row per supported locale, the
 * current one checked.
 *
 * Deliberately not the searchable `LanguageSwitcherPanel`: the locale list is
 * two rows, so a search field, an empty state and a scroll affordance had
 * nothing to filter — and the autofocused input opened the on-screen keyboard
 * over them. This is a plain radiogroup, so opening it moves focus to the
 * chosen row and no keyboard can appear.
 *
 * Arrows move the roving focus only; Enter/Space or a tap commits, because a
 * locale change refreshes the route and unmounts the list.
 */
export function LocaleList({ onDismiss }: LocaleListProps) {
  const t = useTranslations('LanguageSwitcher');
  const { locale, switchTo } = useLocaleSwitcher();
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function moveFocus(event: React.KeyboardEvent, index: number) {
    const last = LANGUAGE_OPTIONS.length - 1;
    const map: Record<string, number> = {
      ArrowDown: Math.min(index + 1, last),
      ArrowRight: Math.min(index + 1, last),
      ArrowUp: Math.max(index - 1, 0),
      ArrowLeft: Math.max(index - 1, 0),
      Home: 0,
      End: last,
    };
    const next = map[event.key];
    if (next === undefined) return;
    event.preventDefault();
    rowRefs.current[next]?.focus();
  }

  return (
    <div role="radiogroup" aria-label={t('label')} className="flex flex-col p-1.5">
      {LANGUAGE_OPTIONS.map((option, index) => {
        const current = option.code === locale;

        return (
          <button
            key={option.code}
            ref={(element) => {
              rowRefs.current[index] = element;
            }}
            type="button"
            // A custom radio: the row hosts the flag and the check at 48px, which a
            // native `<input type="radio">` cannot lay out.
            // eslint-disable-next-line jsx-a11y/prefer-tag-over-role -- see above.
            role="radio"
            aria-checked={current}
            data-current={current || undefined}
            tabIndex={current ? 0 : -1}
            onClick={() => {
              switchTo(option.code);
              onDismiss();
            }}
            onKeyDown={(event) => moveFocus(event, index)}
            className={cn(
              'flex h-12 w-full items-center gap-3 px-2.5 text-left text-sm text-foreground transition-colors hover:bg-secondary',
              CONTROL_RADIUS,
              CONTROL_FOCUS,
            )}
          >
            <LanguageOptionLabel option={option} uiLocale={locale} />
            {current && (
              <Check aria-hidden="true" className="ml-auto size-4 shrink-0 text-primary" />
            )}
          </button>
        );
      })}
    </div>
  );
}
