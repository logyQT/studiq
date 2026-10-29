'use client';

import { ChevronDown, ChevronRight, Globe } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';
import { LanguageSelect } from '@/components/shared/language-switcher/language-select';
import { LanguageSwitcherPanel } from '@/components/shared/language-switcher/language-switcher-panel';
import { LocaleFlag } from '@/components/shared/language-switcher/locale-flag';
import { useLocaleSwitcher } from '@/hooks/use-locale-switcher';
import { cn } from '@/lib/utils';

export type LanguageMenuRowProps =
  | {
      /** Inside a `DropdownMenu` (desktop): a labelled row with a plain select. */
      variant: 'menu';
    }
  | {
      /** Outside a menu (mobile navbar sheet): expands the panel inline. */
      variant: 'plain';
      /** When set (mobile drawer), the row opens a separate language view instead. */
      onOpen?: () => void;
    };

const PLAIN_ROW_CLASS =
  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring';

/**
 * The single language entry of the user menu (#634) — it replaced the two
 * `Polski` / `English` rows, so language is one labelled control in every
 * surface. Both variants show the current language without a check icon
 * (checks belong to the panel's options).
 */
export function LanguageMenuRow(props: LanguageMenuRowProps) {
  const t = useTranslations('LanguageSwitcher');
  const { option } = useLocaleSwitcher();
  const panelId = useId();
  const rowRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  // The inline panel unmounts on selection, taking the focused combobox with
  // it; without this, focus falls back to the surrounding dialog (mobile
  // navbar sheet). Focus is moved before React unmounts the panel, so the
  // unmount cannot steal it.
  const dismissPanel = () => {
    setOpen(false);
    rowRef.current?.focus();
  };

  // Desktop menu: a labelled row with a plain select on the right (same shape
  // as the theme row). No search field here — that lives on touch surfaces.
  if (props.variant === 'menu') {
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-sm">
        <Globe aria-hidden="true" className="size-4 text-muted-foreground" />
        <span className="flex-1">{t('label')}</span>
        <LanguageSelect />
      </div>
    );
  }

  // Mobile drawer: the row drills into a dedicated language view of the same
  // drawer instead of expanding inline (an inline list shifts every row below
  // it and fights the drawer's swipe-to-close).
  if (props.variant === 'plain' && props.onOpen) {
    const onOpen = props.onOpen;
    return (
      <button type="button" onClick={onOpen} className={cn(PLAIN_ROW_CLASS, 'py-3')}>
        <Globe aria-hidden="true" className="size-4 text-muted-foreground" />
        <span>{t('label')}</span>
        <span className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground">
          <LocaleFlag locale={option.code} />
          <span translate="no" lang={option.code}>
            {option.endonym}
          </span>
        </span>
        <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
      </button>
    );
  }

  return (
    <div>
      <button
        ref={rowRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((previous) => !previous)}
        className={PLAIN_ROW_CLASS}
      >
        <Globe aria-hidden="true" className="size-4 text-muted-foreground" />
        <span>{t('label')}</span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <LocaleFlag locale={option.code} />
          <span translate="no" lang={option.code}>
            {option.endonym}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn('size-4 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div
          id={panelId}
          className="mt-1 overflow-hidden rounded-md border bg-popover text-popover-foreground"
        >
          <LanguageSwitcherPanel autoFocus={false} onDismiss={dismissPanel} />
        </div>
      )}
    </div>
  );
}
