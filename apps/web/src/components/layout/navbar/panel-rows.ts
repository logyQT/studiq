import { FOCUS_RING } from '@/components/shared/focus-ring';
import { cn } from '@/lib/utils';

/**
 * One row language for the two header panels. The burger says where you can go,
 * the account panel says who you are, but both are lists of full-bleed rows on
 * the same surface, so the metrics live here instead of in each panel:
 *
 *   height 72px (`min-h-18`) · inset 16px (`px-4`) · label 20px/600
 *   leading icon 20px · gap 12px · trailing arrow 20px at the icon's weight
 *
 * 72px, not the burger's old 80px: 320×568 leaves 504px below the header, and
 * at 80px the signed-in burger (six rows plus the preference band) overflowed
 * by 49px while the account panel's identity, four rows and logout left almost
 * no air. 72px is still far above the 44px touch target and leaves the account
 * panel a visible gap.
 *
 * The list's 4px gutter is the focus ring's room: a row is full width, so the
 * first one touches the scrollport's top edge and its 2px ring at a 2px offset
 * was clipped there — and at both side edges. `p-1` around the list makes the
 * ring whole without moving the indicator inside the row, where it would read
 * as a second hairline. It costs 8px of list height: the signed-in burger's six
 * rows and the five hairlines between them are 437px, which becomes 445px
 * against the 435px the preference band (68px plus its top hairline) leaves, so
 * its list now scrolls 10px instead of 2px. The last row's bottom edge is
 * clipped by that much until the list is scrolled; the row's height and the
 * band's controls are the trade, and the 320×568 budget still holds — the panel
 * itself never exceeds the viewport, only the list inside it scrolls.
 */
export const PANEL_ROW = cn(
  'group flex min-h-18 w-full items-center gap-3 px-4 py-3 text-xl leading-tight font-semibold tracking-tight text-foreground transition-colors hover:bg-accent',
  FOCUS_RING,
);

/** The leading icon column of an account row. */
export const PANEL_ROW_ICON = 'size-5 shrink-0 text-muted-foreground';

/**
 * The trailing arrow, on rows that navigate and only those. A destructive row
 * or a toggle does something else, so it carries no arrow.
 */
export const PANEL_ROW_ARROW =
  'size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:translate-x-0';

/**
 * The list owns every boundary. `divide-y` paints exactly one 1px line between
 * siblings, so two stacked rows cannot each draw an edge and double it.
 * `divide-input`, not `divide-border`: DESIGN §Boundaries makes separators
 * between interactive rows load-bearing (≥3:1), and both panels are rows.
 */
export const PANEL_LIST = 'divide-y divide-input';

/**
 * The panel shell both surfaces share: it drops from the header's bottom edge
 * (`--header-height`, the same token the bar sets and the anchor offset reads)
 * to the viewport bottom at full width, under the header's `z-50` so the header
 * hairline is its top edge, and flat — no border, radius or shadow.
 */
export const PANEL_SHEET = cn(
  'top-(--header-height) bottom-0 z-40 flex w-full max-w-none flex-col gap-0 overflow-hidden border-0 bg-background p-0 shadow-none',
  // The kit ships its own 16px close button with an English label; both panels
  // are closed by the header control that opened them, so neither gets one.
  '[&>button:last-child]:hidden',
);
