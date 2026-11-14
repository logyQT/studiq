/**
 * Solid 2px ring at a 2px offset.
 *
 * The kit's `ring-ring/50` measures 2.45:1 over paper, below the 3:1 that 1.4.11
 * requires of a non-text indicator (DESIGN §Accessibility floor). Every control
 * that draws its own ring — the header's, the marketing CTAs, the preference
 * pair — reads this one, so the four surfaces cannot drift into four rings.
 */
export const FOCUS_RING =
  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none';
