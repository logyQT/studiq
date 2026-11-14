# DESIGN.md

The visual system for StudiQ. Read [PRODUCT.md](PRODUCT.md) first: this file decides how
the product looks, that file decides what it is allowed to say.

Scope: the marketing surface (`/`, `/pricing`, `/features`, `/contact`) is designed here.
The product surface (`/app`, `/edu`, `/manage`, admin) keeps the `@studiq/ui` kit and
inherits these tokens without being redesigned.

## The world

**Fast and sharp.** The page should read like a stopwatch, not a brochure: paper-white
space, one saturated blue carrying the identity, one acid accent that only ever appears
where the visitor is supposed to act, tight radii, hairline rules, type set close and
confident. Nothing blurred, nothing glowing, nothing padded into softness.

Why this world: the product's promise is time saved under deadline pressure. A calm
editorial page would read as "study app", which is what every competitor already is. A
sharp, high-contrast page reads as speed, which is the actual claim.

It is also the opposite of the direction we are leaving: the current page is centered,
soft (0.75rem radii), violet-to-cyan, and blurred. Every rule below can be traced back
to that.

## Palette

Values are OKLCH, because lightness and chroma move predictably there. Hex is given for
design tools. Contrast ratios are measured against the surface named after each row.

### Light (default)

| Token          | OKLCH             | Hex       | Role                                           | Contrast                                    |
| -------------- | ----------------- | --------- | ---------------------------------------------- | ------------------------------------------- |
| `paper`        | `0.972 0.008 85`  | `#F8F5F0` | Page background. Warm off-white, never `#fff`. | —                                           |
| `paper-sunk`   | `0.948 0.010 85`  | `#F1EDE6` | Recessed bands, table stripes, input wells     | —                                           |
| `ink`          | `0.175 0.022 264` | `#0C101A` | All body and heading text                      | **17.50:1** on paper                        |
| `ink-muted`    | `0.470 0.030 264` | `#525B6C` | Secondary text, captions, metadata             | **6.30:1** on paper                         |
| `hairline`     | `0.880 0.012 264` | `#D3D8E0` | 1px borders and rules. Non-text only.          | 1.32:1                                      |
| `cobalt`       | `0.455 0.215 264` | `#1244CB` | Brand. Links, nav, focus, primary fill.        | **7.15:1** on paper · 6.66:1 on paper-sunk  |
| `cobalt-hover` | `0.560 0.200 264` | `#3569E7` | Hover lightening of a cobalt fill only         | 4.47:1 on paper — **not text**              |
| `signal`       | `0.880 0.210 122` | `#C1EC16` | The accent. Action, highlight, one word.       | 13.76:1 against ink · 5.62:1 against cobalt |

### Dark

| Token       | OKLCH             | Hex       | Role                   | Contrast      |
| ----------- | ----------------- | --------- | ---------------------- | ------------- |
| `bg`        | `0.155 0.020 264` | `#080C15` | Page background        | —             |
| `card`      | `0.215 0.022 264` | `#141924` | Raised surfaces        | —             |
| `ink`       | `0.960 0.006 85`  | `#F4F1ED` | Text                   | **17.41:1**   |
| `ink-muted` | `0.680 0.020 264` | `#9298A5` | Secondary text         | **6.78:1**    |
| `cobalt`    | `0.680 0.180 264` | `#5E92FF` | Brand, lifted for dark | **6.54:1**    |
| `signal`    | `0.880 0.210 122` | `#C1EC16` | Unchanged              | 14.18:1 on bg |

### Dosage

The accent is a scalpel, not a wash. On any single viewport:

- **`signal` ≤ 5% of painted area.** It is only ever: a filled primary CTA, a 2px
  underline under one word, a 1px offset ring, or a single highlighted figure.
- **Never `signal` as text on `paper`** — measured at **1.27:1**, unreadable. As a fill it
  takes `ink` text (13.76:1).
- **`cobalt` carries identity**, not decoration: links, the nav, rules, one hero element,
  the focus ring. Full-bleed cobalt is allowed exactly once per page (the closing CTA).
- **`paper` carries space.** Three saturated surfaces can never touch.

### Retired, with reasons

- **`--secondary: violet`, "for AI / premium features."** A second brand hue that did no
  informational work and made AI look like a different product. AI is not a color.
- **The `--primary` hue at `0.546 0.245 265`.** That value is indigo, and `globals.css`
  documents it as "Quizlet-inspired". We do not build the brand on a competitor's color,
  and indigo-plus-violet is the default every generated page lands on.
- **Violet-to-cyan `blur-3xl` blobs.** Hero decoration that reads as "no decision was
  made here".
- **Rainbow icon tints** (`bg-blue-500/10 text-purple-500 …`). Six hues with no meaning.

## Typography

Three roles, two families plus the mono already loaded.

| Role         | Family                              | Where                                    | Notes                                                                                    |
| ------------ | ----------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| Display      | **Archivo** (variable, `wdth` axis) | h1, h2, section numerals                 | Tight tracking, high weight. The `wdth` axis lets the hero condense instead of wrapping. |
| Body / UI    | **Geist**                           | everything else                          | Already in `layout.tsx`. Sharp, technical, correct here.                                 |
| Label / data | **Geist Mono**                      | eyebrows, units, figures, table numerals | Uppercase 0.75rem, tracking `0.08em`.                                                    |

Scale — one ramp, no one-off sizes:

| Step    | Size                               | Line height | Tracking  | Use                          |
| ------- | ---------------------------------- | ----------- | --------- | ---------------------------- |
| Display | `clamp(2.75rem, 6vw, 5.5rem)`      | `0.98`      | `-0.03em` | Hero h1 only                 |
| H2      | `clamp(1.75rem, 3vw, 2.5rem)`      | `1.05`      | `-0.02em` | Section titles               |
| H3      | `1.25rem`                          | `1.3`       | `-0.01em` | Card and step titles         |
| Lede    | `clamp(1.0625rem, 1.6vw, 1.25rem)` | `1.55`      | `0`       | The paragraph under the hero |
| Body    | `1rem`                             | `1.6`       | `0`       | Everything readable          |
| Small   | `0.875rem`                         | `1.5`       | `0`       | Captions, helper text        |
| Label   | `0.75rem`                          | `1.4`       | `0.08em`  | Mono, uppercase              |

Rules:

- Body measure stops at `66ch`. Never full-container width.
- Display type is never smaller than `1.5rem`: below that it is just bold body.
- Mono is never used for a paragraph. It marks a value, a unit or a label.
- Numbers that are compared use `font-variant-numeric: tabular-nums`.
- Two weights per screen, three at most (`400`, `600/650`, `700` display).

## Layout and rhythm

- **8pt baseline.** Spacing comes from `8 / 16 / 24 / 32 / 48 / 64 / 96 / 128`. No arbitrary
  values, no `gap-7`.
- **Section rhythm:** `96px` block padding on mobile, `128px` from `md` up. Sections are
  separated by space, not by alternating background colors.
- **Container:** `1120px` for prose and cards, `1280px` for full-bleed media. Gutters come
  from the existing `px-content` utility — do not hand-roll padding.
- **Asymmetry is the default on marketing.** A 7/5 or 8/4 split, an off-center hero, text
  against image. Centered-everything is the pattern we are leaving; allow one centered
  band per page, at most.
- **Grid:** 12 columns from `md`, 4 on mobile. Cards do not all get the same span.

> Implementation note: `MainLayout` wraps marketing children in
> `max-w-7xl px-4 py-8`, so every section today is constrained and padded twice and
> full-bleed bands are impossible. Marketing needs a layout shell without that inner
> wrapper before any of the above can land.

## Shape and elevation

- **Radii:** `2px` controls, `4px` cards, `6px` panels. `--radius` moves from `0.75rem` to
  `0.375rem`. Pills are reserved for status, never for buttons.
- **Borders:** `1px solid hairline`. A border plus a shadow is a mistake.
- **Shadow:** exactly one, flat: `0 1px 2px rgb(12 16 26 / 0.06)`. No glow, no blur above
  `8px`, no colored shadow.
- **No glassmorphism, no gradient meshes, no `backdrop-blur`, no `blur-3xl`.**

Sharp means the geometry tells the truth about where the edge is.

## Motion

Fast and sharp means motion finishes before it is noticed.

- `140ms` for hover and press, `220ms` for an entrance, `320ms` is the ceiling.
- One easing curve: `cubic-bezier(0.2, 0, 0, 1)` — leaves quickly, settles without bounce.
- Entrances animate `opacity` and `transform` only, and happen once per page, not per section
  on scroll.
- **No looping animation.** Nothing pulses, breathes or floats.
- Every animation is wrapped by `prefers-reduced-motion: reduce`, which removes transforms
  and keeps opacity changes instant.

## Two modes

The same tokens, two different levels of ambition.

| Surface                                  | Mode     | Built from                                                                                                              |
| ---------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| `/`, `/pricing`, `/features`, `/contact` | Persuade | Page-owned layout + tokens. 3–4 purpose-built marketing components. Kit only where invisible (Button, Badge semantics). |
| `/app`, `/edu`, `/manage`, admin         | Operate  | `@studiq/ui` as-is. Familiarity beats surprise once someone is working.                                                 |

The rule that follows: **a marketing section is not a card grid.** If a section can be
expressed as "N equal `<Card>`s in a row", it is the kit's default layout wearing a
headline, and it is what made the page look generic. Change the composition, not the copy.

## Anti-patterns

Each of these exists in the current page. None may return.

1. Blurred gradient blobs behind the hero.
2. A sparkles-icon badge sitting above the h1.
3. Three or four equal cards as the only presentation of a feature set.
4. Rainbow icon tints. One accent per page, not one per icon.
5. Gradient text, glassmorphism, side-stripe borders on cards.
6. Counters the product cannot measure. See [PRODUCT.md](PRODUCT.md#launch-blockers).
7. Centered hero + centered section + centered CTA, start to finish.
8. "AI-powered" used as an adjective in a badge. Name the action instead.
9. Em dashes in marketing copy.
10. A `Card` that only wraps another `Card`, or a section component that only renames a div.

## Token migration

Mechanical, so implementation is not a design negotiation. All of it lands in
`apps/web/src/app/globals.css` (`:root`, `.dark`, `@theme inline`).

| Token                  | Today                          | Becomes                      |
| ---------------------- | ------------------------------ | ---------------------------- |
| `--background`         | `0.978 0.007 247` (cool white) | `0.972 0.008 85` (paper)     |
| `--foreground`         | `0.13 0.015 265`               | `0.175 0.022 264` (ink)      |
| `--primary`            | `0.546 0.245 265` (indigo)     | `0.455 0.215 264` (cobalt)   |
| `--primary-foreground` | `0.985 0 0`                    | `0.972 0.008 85` (paper)     |
| `--secondary`          | `0.94 0.035 265` (violet tint) | neutral: `0.948 0.010 85`    |
| `--muted-foreground`   | `0.52 0.03 265`                | `0.470 0.030 264`            |
| `--border` / `--input` | `0.908 0.012 262`              | `0.880 0.012 264` (hairline) |
| `--ring`               | `0.546 0.245 265`              | `0.455 0.215 264` (cobalt)   |
| `--radius`             | `0.75rem`                      | `0.375rem`                   |
| `--signal`             | _does not exist_               | **new:** `0.880 0.210 122`   |

**Do not map `--signal` onto `--accent`.** `--accent` is the shadcn hover surface used by
menus, selects and the sidebar across 62 components; pointing it at the accent would paint
every menu row acid lime. `--signal` is a new, explicitly consumed token.

`--success`, `--warning`, `--destructive` keep their hues and are re-tuned for the paper
background. `--brand-accent` (org branding, issue #108) keeps pointing at `--primary` and
therefore follows cobalt automatically.

## Accessibility floor

Non-negotiable, and measured rather than assumed:

- Body text ≥ 4.5:1, large text ≥ 3:1, UI boundaries ≥ 3:1 against their surface.
- `signal` is never text on `paper`. It carries `ink` when used as a fill.
- Focus is visible on every interactive element: `2px` cobalt ring with a `2px` paper
  offset. Never `outline: none`.
- One `<h1>` per page, no skipped heading levels.
- Touch targets ≥ 44×44px.
- Links inside body copy are distinguished by underline or weight, not color alone.
- Every motion respects `prefers-reduced-motion`.

## Open decisions

1. **Fonts.** Archivo is the recommendation; it adds one family to the two already loaded
   and is free via `next/font/google`. Reject it before implementation, not after.
2. **The AI premium promise.** Two of the three AI features advertised on the Premium card
   are unshipped ([PRODUCT.md](PRODUCT.md#launch-blockers)). That is a product decision
   blocking the pricing section, not a design one.
3. **Marketing layout shell.** Required before full-bleed sections can be built.
4. **Dark-mode budget.** The tokens are defined above; whether the marketing pages ship
   dark parity in the first pass is undecided. The product surfaces already have dark.
