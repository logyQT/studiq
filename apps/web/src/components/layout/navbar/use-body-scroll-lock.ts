'use client';

import { useEffect } from 'react';

/**
 * Lock page scrolling while a panel is open.
 *
 * Radix only locks scrolling for modal dialogs, and both header panels are
 * deliberately non-modal so the header stays live while they are open — which
 * makes the lock ours to keep. Restoring the previous inline value rather than
 * clearing it matters: a panel closing must not stomp a lock another surface owns.
 */
export function useBodyScrollLock(open: boolean) {
  useEffect(() => {
    const { body } = document;
    const previous = body.style.overflow;
    if (open) body.style.overflow = 'hidden';
    return () => {
      if (open) body.style.overflow = previous;
    };
  }, [open]);
}
