'use client';

import { PopoverContent } from '@studiq/ui';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { LocaleList } from '@/components/shared/language-switcher/locale-list';
import { PANEL_RADIUS } from '@/components/shared/preference-controls';
import { cn } from '@/lib/utils';

export type LanguageSwitcherContentProps = {
  onDismiss: () => void;
  /** Where focus returns on close. Omit → Radix restores the `PopoverTrigger` (footer). */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  sideOffset?: number;
  className?: string;
};

/**
 * Popover shell for the surfaces that open a layer (footer, navbar) — the
 * list inside is identical everywhere (#634).
 *
 * The popover is non-modal, but Radix's `FocusScope loop` still wraps Tab back
 * into it (verified) — it does **not** dismiss on focus-out. Dismissal is
 * Escape, an outside click or a selection, and `onCloseAutoFocus` returns focus
 * to the trigger.
 */
export function LanguageSwitcherContent({
  onDismiss,
  returnFocusRef,
  align = 'end',
  side = 'bottom',
  sideOffset = 8,
  className,
}: LanguageSwitcherContentProps) {
  const t = useTranslations('LanguageSwitcher');
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <PopoverContent
      ref={contentRef}
      // Radix renders a portal div; the app's layer guards look for role=dialog.
      // eslint-disable-next-line jsx-a11y/prefer-tag-over-role -- no tag can replace the portal content.
      role="dialog"
      aria-label={t('label')}
      align={align}
      side={side}
      sideOffset={sideOffset}
      // 16px from the viewport edge when collision-shifted, so a popover over a
      // trigger at the screen edge still lines up with it instead of hugging x=0.
      collisionPadding={16}
      className={cn('w-64 border-border bg-background p-0 shadow-none', PANEL_RADIUS, className)}
      // Radix would focus the first tabbable row; focus the chosen one instead.
      // Never a text field: this is the touch path, and a focused input opens the
      // keyboard over a two-row list.
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        contentRef.current
          ?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
          ?.focus();
      }}
      onCloseAutoFocus={(event) => {
        // The menu surfaces render no `PopoverTrigger` (the trigger is a menu
        // button), so Radix has nothing to restore focus to — do it explicitly.
        if (!returnFocusRef?.current) return;
        event.preventDefault();
        returnFocusRef.current.focus();
      }}
    >
      <LocaleList onDismiss={onDismiss} />
    </PopoverContent>
  );
}
