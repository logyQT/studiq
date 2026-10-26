'use client';

import { DropdownMenuItem } from '@studiq/ui';
import { ChevronDown, ChevronRight, Globe } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';
import { LanguageSwitcherPanel } from '@/components/shared/language-switcher/language-switcher-panel';
import { useLocaleSwitcher } from '@/hooks/use-locale-switcher';
import { cn } from '@/lib/utils';

export type LanguageMenuRowProps =
  | {
      /**
       * Inside a `DropdownMenu`: the row closes the menu and opens the shared
       * panel in a Popover anchored to the menu trigger.
       */
      variant: 'menu';
      onRequestPanel: () => void;
    }
  | {
      /** Outside a menu (mobile navbar sheet): expands the panel inline. */
      variant: 'plain';
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

  if (props.variant === 'menu') {
    return (
      <DropdownMenuItem aria-haspopup="dialog" onSelect={() => props.onRequestPanel()}>
        <Globe aria-hidden="true" className="size-4 text-muted-foreground" />
        <span>{t('label')}</span>
        <span className="ml-auto text-xs text-muted-foreground">{option.endonym}</span>
        <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
      </DropdownMenuItem>
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
        <span className="ml-auto text-xs text-muted-foreground">{option.endonym}</span>
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
