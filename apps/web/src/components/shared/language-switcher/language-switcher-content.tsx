'use client';

import { PopoverContent } from '@studiq/ui';
import { useTranslations } from 'next-intl';
import { LanguageSwitcherPanel } from '@/components/shared/language-switcher/language-switcher-panel';
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
 * Popover shell for the surfaces that open a layer (footer, navbar, sidebar) —
 * the panel inside is identical everywhere (#634).
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

  return (
    <PopoverContent
      role="dialog"
      aria-label={t('label')}
      align={align}
      side={side}
      sideOffset={sideOffset}
      className={cn('w-64 p-0', className)}
      onCloseAutoFocus={(event) => {
        // The menu surfaces render no `PopoverTrigger` (the trigger is a menu
        // button), so Radix has nothing to restore focus to — do it explicitly.
        if (!returnFocusRef?.current) return;
        event.preventDefault();
        returnFocusRef.current.focus();
      }}
    >
      <LanguageSwitcherPanel onDismiss={onDismiss} />
    </PopoverContent>
  );
}
