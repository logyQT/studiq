import { cn } from '@/lib/utils';

/**
 * Solid 2px ring at a 2px offset — the kit's `ring-ring/50` is 2.45:1 on paper,
 * below the 3:1 non-text floor (DESIGN §Accessibility floor).
 */
export const FOCUS_RING =
  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none';

/**
 * The header's 44px icon-button shape — the burger, the signed-out account mark
 * and the signed-in avatar all resolve to the same square, so the header's two
 * controls sit on one baseline.
 */
export const HEADER_ICON = cn(
  'inline-flex size-11 items-center justify-center rounded-control text-foreground transition-colors hover:bg-accent',
  FOCUS_RING,
);
