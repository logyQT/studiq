/**
 * Chrome and geometry shared by the two preference controls (theme, language).
 *
 * They sit next to each other in the footer and in the mobile menu, so the
 * frame, the focus ring, the hover surface *and the row geometry* are declared
 * once here instead of being copied into both. The kit's focus ring is
 * `ring-ring/50`, which measures 2.45:1 over paper and fails 1.4.11
 * (DESIGN §Accessibility floor), so these controls draw the solid ring at a 2px
 * offset.
 */

/**
 * The kit's controls ship `rounded-md` (10px) / `rounded-sm` (8px). A
 * theme-named radius is not a scale value, so tailwind-merge keeps both classes
 * and the cascade order decides — and `.rounded-control` is emitted *before*
 * both. Spelling the token's value out lets `cn` collapse the conflict at the
 * call site instead of gambling on emission order. Keep in sync with
 * `--radius-control` / `--radius-panel` (DESIGN §Shape).
 */
export const CONTROL_RADIUS = 'rounded-[0.25rem]';
export const PANEL_RADIUS = 'rounded-[0.5rem]';

/**
 * One geometry for the pair, in border-box terms.
 *
 * `box` is the control's outer height, borders included, so the language
 * trigger and the theme group resolve to the same rectangle in one row: 44px on
 * touch surfaces (the language trigger claims `h-11`) and 32px on the compact
 * desktop row (the select claims `h-8`). The theme group sets `box` on its frame
 * and its segments fill the frame's content box (`CONTROL_SEGMENT`), so
 * 42px + two 1px edges = 44 and 30px + two 1px edges = 32 — the active fill
 * cannot sit inset from the frame.
 */
export const PREFERENCE_GEOMETRY = {
  touch: 'h-11',
  compact: 'h-8',
} as const;

/**
 * One segment of the theme group: 40px wide — the 16px glyph plus 12px of
 * breathing room on each side, which is exactly `CONTROL_PAD_X` on the language
 * trigger — and the frame's full content height, so the active fill reaches the
 * frame's inner edge top and bottom. `SEGMENT_WIDTH` mirrors that 40px for the
 * sliding thumb's translate.
 */
export const CONTROL_SEGMENT = 'h-full w-10';
export const SEGMENT_WIDTH = 40;

/** The 16px glyph box: the theme icons and the locale flag both use it. */
export const CONTROL_GLYPH = 'size-4';

/** Edge padding of a control's label: matches the segment's icon breathing room. */
const CONTROL_PAD_X = 'px-3';

/**
 * Frame: 1px `border-input`, the control radius, paper, no shadow.
 *
 * `border-input` (`border-control`, 3.23:1 on paper) rather than the decorative
 * `border` hairline (1.32:1): these two controls sit in one row doing the same
 * job and each is identified by its edge, which DESIGN §Boundaries puts above
 * 3:1. One of them carrying the hairline made the pair read as two different
 * component families.
 */
export const CONTROL_CHROME = `${CONTROL_RADIUS} border border-input bg-background`;

/** Solid 2px ring at a 2px offset. */
export const CONTROL_FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/**
 * Quiet trigger — the language control on every surface, plus the desktop
 * select. The edge weight comes from `CONTROL_CHROME`, which is shared with the
 * theme group so the two frames cannot drift apart again.
 */
export const TRIGGER_CHROME = `inline-flex items-center gap-2 ${CONTROL_PAD_X} text-sm text-foreground whitespace-nowrap ${CONTROL_CHROME} transition-colors hover:bg-secondary ${CONTROL_FOCUS}`;
