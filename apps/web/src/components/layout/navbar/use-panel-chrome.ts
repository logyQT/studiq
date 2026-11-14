'use client';

import { useRef } from 'react';
import { useBodyScrollLock } from '@/components/layout/navbar/use-body-scroll-lock';

/**
 * The preamble both header panels share: a ref for the panel element, a `close`
 * that routes through the owner's state, and the scroll lock Radix does not apply
 * because these panels are non-modal on purpose.
 */
export function usePanelChrome(open: boolean, onOpenChange: (open: boolean) => void) {
  const panelRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock(open);

  return {
    panelRef,
    close: () => onOpenChange(false),
    /**
     * Focus goes to the panel itself, not to its first control: the dialog
     * announces its name, and Tab then enters the list. Left on the trigger,
     * Tab would fall through to the page underneath, which the panel covers.
     */
    onOpenAutoFocus: (event: Event) => {
      event.preventDefault();
      panelRef.current?.focus();
    },
  };
}
