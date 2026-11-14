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
  return { panelRef, close: () => onOpenChange(false) };
}
