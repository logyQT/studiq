# DESIGN.md

The visual system for StudiQ. Read [PRODUCT.md](PRODUCT.md) first: this file decides how
the product looks, that file decides what it is allowed to say.

Scope: the marketing surface (`/`, `/pricing`, `/features`, `/contact`) is designed here.
Product surfaces (`/app`, `/edu`, `/manage`, admin) inherit these tokens but are not
redesigned. Where a rule would reach into `packages/ui`, this document says so and says
why, instead of hiding it behind "inherits without being redesigned".

## The world

**Fast and sharp.** The page should read like a stopwatch, not a brochure: warm paper
space, one saturated blue carrying identity, one acid accent that only appears where the
visitor is supposed to act, tight corners, hairline rules, type set close and confident.
Nothing blurred, nothing glowing, nothing padded into softness.

Why this world: the product promises time saved under deadline pressure. A calm editorial
page reads as "study app", which is what every competitor already is. High contrast at
speed reads as the actual claim.

### What actually changes, measured

Honesty about the delta matters more than the label. Against the current
`--primary: oklch(0.546 0.245 265)` (`#275BFC`):

|                     | old        | new       | delta                               |
| ------------------- | ---------- | --------- | ----------------------------------- |
| Primary lightness   | 0.546      | 0.455     | 0.091 darker                        |
| Primary chroma      | 0.245      | 0.215     | less electric                       |
| Primary hue         | 265.0°     | 263.9°    | **1.1° — no meaningful hue change** |
| Perceptual distance |            |           | ΔE<sub>ok</sub> ≈ 9.6               |
| Background hue      | 247 (cool) | 85 (warm) | genuine flip                        |

So: the blue stays blue and gets deeper, and it is **not** true that we are leaving a
competitor's hue, because the old value was already at cobalt's hue. The identity change
comes from the paper flip, the geometry (2–6px corners instead of 12px), the hairline
rules, the type, and the accent. One genuinely new colour exists, and it is `signal`.

That is a deliberate trade: a hue move this late would look like a different brand rather
than a sharper one. If the page still reads generic after the redesign, the palette is the
last thing to change, not the first.

## Palette

OKLCH, because lightness and chroma move predictably there. Hex is for design tools.
Every contrast ratio below is measured, not estimated, and the gamut column records
whether the value survives conversion to sRGB. A clipped colour renders as something the
document does not describe, so clipped values are rejected rather than published.

### Light (default)

| Token            | OKLCH                | Hex       | Gamut | Role                                                | Contrast                         |
| ---------------- | -------------------- | --------- | ----- | --------------------------------------------------- | -------------------------------- |
| `paper`          | `0.972 0.014 85`     | `#FAF5EB` | ok    | Page background. Warm, never `#fff`.                | —                                |
| `paper-sunk`     | `0.945 0.016 85`     | `#F2ECE1` | ok    | Recessed bands, table stripes                       | —                                |
| `card`           | `0.985 0.006 85`     | `#FCFAF6` | ok    | Raised surfaces, separated by border not brightness | —                                |
| `ink`            | `0.175 0.022 264`    | `#0C101A` | ok    | All text                                            | **17.50:1** paper · 18.18:1 card |
| `ink-muted`      | `0.470 0.020 264`    | `#555B66` | ok    | Secondary text                                      | **6.30:1** paper · 5.81:1 sunk   |
| `hairline`       | `0.880 0.012 85`     | `#DBD7CF` | ok    | Decorative rules only                               | 1.32:1                           |
| `border-control` | `0.630 0.020 264`    | `#838996` | ok    | Field and outline-button borders                    | **3.23:1** paper · 3.35:1 card   |
| `secondary`      | `0.905 0.012 85`     | `#E3DFD7` | ok    | Non-interactive chip fill                           | 1.22:1 (see §Boundaries)         |
| `accent-surface` | `0.930 0.012 85`     | `#EBE7DF` | ok    | Hover surface for menus and rows                    | 1.13:1                           |
| `cobalt`         | `0.455 0.215 264`    | `#1244CB` | ok    | Brand: nav, links, focus, closing band              | **7.15:1** paper · 7.43:1 card   |
| `cobalt-hover`   | `0.560 0.200 264`    | `#3569E7` | ok    | Hover of a cobalt fill only                         | 4.47:1 — never text              |
| `signal`         | `0.880 0.210 122`    | `#C1EC16` | ok    | The accent                                          | 13.76:1 ink · 5.62:1 cobalt      |
| `destructive`    | `0.560 0.185 27.325` | `#CA3731` | ok    | Errors, destructive actions                         | **4.71:1** paper                 |
| `success`        | `0.505 0.100 155`    | `#2B754B` | ok    | Confirmation                                        | **5.16:1** paper · 4.76:1 sunk   |
| `warning`        | `0.530 0.100 75`     | `#8D621C` | ok    | Caution                                             | **4.95:1** paper · 4.57:1 sunk   |

The previous semantic set failed on paper: `destructive` was 4.39:1, `success` 2.74:1,
`warning` 2.10:1. Those were tuned for a cool white page and do not survive the warm one.

### Dark

Page background is **cobalt-tinted** (`#050C1B`), not neutral near-black, so dark mode
reads as the brand rather than as the default theme inverted. This is the live mode for
anyone whose OS is dark (`defaultTheme="system"`), not an optional extra.

| Token            | OKLCH                | Hex       | Gamut | Contrast                          |
| ---------------- | -------------------- | --------- | ----- | --------------------------------- |
| `bg`             | `0.155 0.035 264`    | `#050C1B` | ok    | —                                 |
| `card`           | `0.215 0.022 264`    | `#141924` | ok    | —                                 |
| `sunk`           | `0.190 0.030 264`    | `#0D1421` | ok    | 1.00:1 vs bg                      |
| `ink`            | `0.960 0.006 85`     | `#F4F1ED` | ok    | **17.42:1** bg · 15.60:1 card     |
| `ink-muted`      | `0.720 0.020 264`    | `#9EA5B2` | ok    | **7.89:1** bg · 7.06:1 card       |
| `border-control` | `0.520 0.025 264`    | `#626978` | ok    | **3.55:1** bg · 3.18:1 card       |
| `cobalt`         | `0.680 0.150 264`    | `#6895F4` | ok    | **6.69:1** bg · 5.99:1 card       |
| `signal`         | `0.880 0.210 122`    | `#C1EC16` | ok    | 14.19:1 bg                        |
| `destructive`    | `0.620 0.180 27.325` | `#DE4F46` | ok    | 4.93:1 bg (4.42:1 card — bg only) |
| `success`        | `0.720 0.130 155`    | `#57BC80` | ok    | 8.33:1 bg                         |
| `warning`        | `0.780 0.125 75`     | `#E6AB53` | ok    | 9.62:1 bg                         |

An earlier draft used `0.680 0.180 264` for dark cobalt. That value is **out of sRGB
gamut** (blue channel 1.064, clamped by the browser), so it rendered as
`#5E92FF` while claiming to be a different colour. Chroma now stops at 0.150.

### `--primary-foreground` flips between modes

The text colour that sits on a cobalt fill is not the same in both modes, and carrying
the light value into dark produces unreadable buttons:

| Fill                     | Text              | Ratio      | Verdict              |
| ------------------------ | ----------------- | ---------- | -------------------- |
| light `cobalt` `#1244CB` | `paper` `#FAF5EB` | **7.15:1** | correct              |
| light `cobalt`           | `ink` `#0C101A`   | 2.45:1     | fails                |
| dark `cobalt` `#6895F4`  | `paper`           | 2.76:1     | **fails — the trap** |
| dark `cobalt`            | `ink` `#0C101A`   | **6.48:1** | correct              |

So `--primary-foreground` is `paper` in light and `ink` in dark. Any new component that
hardcodes one of them is broken in the other mode.

### Dosage

The accent is a scalpel, not a wash. Per viewport:

- **`signal` ≤ 5% of painted area.** Reserved for exactly three uses: the primary CTA fill,
  a 2px underline under one word, and a focus ring inside cobalt regions.
- **`signal` is never text on `paper`** — 1.27:1. It takes `ink` when used as a fill
  (13.76:1), and it _is_ usable as text on `cobalt` (5.62:1) and in dark mode (14.19:1).
  The dosage rule inverts with the mode; do not carry the light-mode ban into dark.
- **`cobalt` carries identity**: nav, links, focus, rules, and exactly one full-bleed band
  per page (the closing CTA).
- **`paper` carries space.** The two saturated fills (cobalt, `signal`) never touch: paper
  separates them.

**One primary action per screen.** Marketing CTAs are `signal` fills with `ink` text,
built as a marketing-local component (§Components), not a new `Button` variant. The kit's
default `Button` stays cobalt, which is correct for the product surfaces. Cobalt and
`signal` never both act as "the" button on the same screen.

### Retired, with reasons

- **`--secondary` as a violet tint** (`0.94 0.035 265`) — a second brand hue doing no
  informational work, and AI is not a colour.
- **Violet hover surfaces**: `--accent 0.944 0.015 265`, `--accent-foreground 0.35 0.1 265`,
  `--secondary-foreground 0.32 0.12 265`, `--sidebar-accent*`, and `--info`, which is
  literally the retired indigo and still paints the toast info icon. On a hue-85 page
  these are a 180° inversion between surface and hover.
- **Violet-to-cyan `blur-3xl` blobs**, and `backdrop-filter: blur(8px)` on toasts
  (`globals.css:236`), which the "no glassmorphism" rule would otherwise forbid in the
  very file this document edits.
- **Rainbow icon tints** — six hues with no meaning (`features.tsx`, `how-it-works.tsx`).

## Typography

Three roles. Body and UI stay **Geist**; the display face is new and is scoped to
marketing only, so the product surfaces keep the type they ship today.

| Role         | Family                         | CSS variable              | Where                    |
| ------------ | ------------------------------ | ------------------------- | ------------------------ |
| Display      | **Archivo** (variable, `wdth`) | `--font-display`          | Marketing h1/h2 only     |
| Body / UI    | **Geist**                      | `--font-sans` (unchanged) | Everything else          |
| Label / data | **Geist Mono**                 | `--font-mono`             | Eyebrows, units, figures |

`--font-sans` feeds `<body>` app-wide. Archivo lands as a separate `--font-display` token
plus a `font-display` utility, applied by the marketing wrapper element, and it lands with
the token migration rather than before it. Adding a third family costs two more `woff2`
files on the critical path of a page whose whole pitch is speed; that is the trade,
accepted knowingly.

### Polish comes first, and the subsets do not currently cover it

The current fonts are loaded with `subsets: ['latin']` (`layout.tsx:24,29`). Polish
`ą ę ł ś ż ź ć ń` live in **latin-ext**, so today they fall back to system-ui beside
Geist text — visible on the default locale of every page.

- Every family loads `subsets: ['latin', 'latin-ext']`.
- Display leading is **≥ 1.05**, not 0.98: ogonki (`Ą`, `Ę`) need vertical room, and the
  hero section is `overflow-hidden`. Verify `ĄĘŁ` at 5.5rem before freezing the ramp.

### Scale

| Step    | Size                               | Leading | Tracking  | Use                                   |
| ------- | ---------------------------------- | ------- | --------- | ------------------------------------- |
| Display | `clamp(2.75rem, 6vw, 5.5rem)`      | `1.05`  | `-0.03em` | The page's single top-level statement |
| Title   | `clamp(2rem, 4vw, 3.25rem)`        | `1.05`  | `-0.02em` | `/pricing`, `/features` h1            |
| H2      | `clamp(1.75rem, 3vw, 2.5rem)`      | `1.1`   | `-0.02em` | Section titles                        |
| H3      | `1.25rem`                          | `1.3`   | `-0.01em` | Card and step titles                  |
| Lede    | `clamp(1.0625rem, 1.6vw, 1.25rem)` | `1.55`  | `0`       | Hero paragraph                        |
| Body    | `1rem`                             | `1.6`   | `0`       | Everything readable                   |
| Small   | `0.875rem`                         | `1.5`   | `0`       | Captions, helper text                 |
| Label   | `0.75rem`                          | `1.4`   | `0.08em`  | Mono, uppercase                       |

The `Title` step exists because `/pricing` and `/features` render an h1 at
`text-4xl sm:text-5xl` (up to 3rem), which the old ramp had nowhere to put: above the H2
ceiling and below the Display floor.

Rules: body measure ≤ `66ch`; display never below `1.5rem`; mono never used for a
paragraph; tabular numerals for compared figures; two weights per screen, three at most.

## Layout and rhythm

- **Layout rhythm is 8pt**: `8 / 16 / 24 / 32 / 48 / 64 / 96 / 128`, covering section
  padding, gutters and grid gaps. **Component internals stay on the kit's 4px grid**
  (`px-2 py-1.5`, `gap-1.5`, `py-0.5`) — the 8pt set cannot express those and the claim
  "no arbitrary values" is false if it pretends otherwise.
- **Section rhythm:** the space **between** adjacent sections is `128px` on mobile and
  `160px` from `md`. Because every section carries its own vertical padding, that means
  `py-16 md:py-20` per section — not `py-24 md:py-32`, which stacks into 192/256px of dead
  paper and was the first thing visible in the built page. The hero's top padding is the
  exception, since nothing sits above it.
- **Containers:** prose and cards `70rem` (1120px, no Tailwind step — declare it), media
  `80rem`, and full-bleed is `100vw` + `px-content`, not 1280px.
- **Asymmetry is the default on marketing**: 7/5 or 8/4 splits, off-center hero. One
  centered band per page, at most.
- **Grid:** 12 columns from `md`, 4 on mobile. Cards do not all take the same span.

> `MainLayout` wraps children in `max-w-7xl px-4 py-8` (`MainLayout.tsx:13`), so every
> marketing section is currently constrained and padded twice and no band can bleed.
> Marketing needs a shell without that inner wrapper. `/status`, `/privacy` and `/terms`
> use the same layout and will shift with the tokens — their owners should expect it.

## Shape and elevation

- **Radii are new tokens, not a change to `--radius`.** `--radius` is `0.75rem` and the
  kit's steps derive from it (`sm = -4px`, `md = -2px`, `lg = base`, `xl = +4px`), so
  moving the scalar would silently resize 60 components: `rounded-sm` on every dropdown
  row goes 8px → 2px and `card.tsx` goes 16px → 10px. That is a product redesign wearing
  a marketing change.

  Add marketing-scoped tokens instead:

  | Token              | Value            | Utility           | Use                       |
  | ------------------ | ---------------- | ----------------- | ------------------------- |
  | `--radius-control` | `0.25rem` (4px)  | `rounded-control` | Marketing buttons, inputs |
  | `--radius-card`    | `0.375rem` (6px) | `rounded-card`    | Marketing cards           |
  | `--radius-panel`   | `0.5rem` (8px)   | `rounded-panel`   | Marketing panels          |

- **Borders:** `1px`. Decorative rules use `hairline`; anything a user must perceive as a
  control uses `border-control` (≥3:1). §Boundaries explains the split.
- **Shadow:** one flat step, `0 1px 2px rgb(12 16 26 / 0.06)`. The rule is not "never
  border and shadow" — the kit ships `border shadow-sm` on `card.tsx` and `stat-card.tsx`
  and that is fine. The rule is **no shadow larger than the border it sits on**: no glow,
  no blur above 8px, no coloured shadow.
- No glassmorphism, no gradient meshes, no `blur-3xl`.

### Boundaries: decorative vs load-bearing

`hairline` is 1.32:1. That is legitimate for a divider and wrong for a field, so the two
are different tokens and the accessibility floor says which applies where:

- **Decorative** (`--border`, rules, separators): no minimum. It is not information.
- **Load-bearing** (`--input`, outline buttons, any control identified only by its edge, and
  **separators between interactive list rows**): ≥ 3:1 against its surface.
  `border-control` measures 3.23:1 on paper and 3.35:1 on card. On `paper-sunk` it is 2.98:1,
  so **bare controls never sit on `paper-sunk`**.
- **`--secondary` chips** are non-interactive fills carrying text at 6.30:1, so they are
  exempt from the 3:1 boundary rule. If a chip ever becomes interactive it needs a
  `border-control` edge.

## Motion

- `140ms` hover/press, `220ms` entrance, `320ms` ceiling.
- One curve: `cubic-bezier(0.2, 0, 0, 1)`.
- Entrances animate `opacity` and `transform` only, once per page, not per section.
- **No looping animation.** Nothing pulses, breathes or floats.
- Declared as tokens, so it is not prose: `--default-transition-duration: 140ms` and
  `--default-transition-timing-function: cubic-bezier(0.2, 0, 0, 1)` in `@theme`. The kit
  currently ships `duration-200`, `duration-700` and `ease-linear` in places; marketing
  components use the tokens.
- Everything respects `prefers-reduced-motion: reduce`, which drops transforms and keeps
  opacity changes instant.

## Components

Marketing components are page-owned. The kit is used only where it is invisible
(Button semantics, Badge markup).

| Component       | Spec                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `CtaButton`     | `signal` fill, `ink` text (13.76:1), `rounded-control`, height `2.75rem` (44px), hover = `signal` at 90% opacity. One per screen. |
| `Eyebrow`       | Geist Mono, `0.75rem`, uppercase, `0.08em`, `ink-muted`.                                                                          |
| `SectionHeader` | Eyebrow + H2 + lede. Left-aligned by default.                                                                                     |
| `ProofStrip`    | Only renders when passed real data. No fallback numbers.                                                                          |
| `FeatureSplit`  | 7/5 asymmetric text/media. Replaces the equal-card row.                                                                           |

**A marketing section is not a card grid.** If a section can be expressed as "N equal
`<Card>`s in a row", it is the kit's default layout wearing a headline, and it is what made
the page look generic. Change the composition, not the copy.

### Product imagery

The page sells a product, so it has to show one. Text alone does not convert, and this
is the section that makes the difference between a landing page and a brochure.

**Only real captures.** Screenshots come from the running app with seeded demo data
(`bun scripts/demo-seed.ts`), never from stock art, illustration, or a hand-built mock-up.
A drawn approximation of a product that exists is a fabricated claim in the same family as
the invented testimonials, and it is banned for the same reason. If a screen cannot be
seeded with plausible content, it does not go on the page.

| Property   | Rule                                                                                                                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source     | `/public/marketing/{locale}/{shot}.png`, 2× capture, listed in `shots.json`                                                                                                                                                                                                     |
| Locale     | **One set per locale, never mixed.** The chrome is translated by `next-intl`, so a Polish interface wrapped around English demo content ("Northfield University", an aspirin card in English) reads as somebody else's demo. The page picks the set matching the active locale. |
| Aspect     | `16 / 10` frame. Crop the meaningful region; never squash.                                                                                                                                                                                                                      |
| Frame      | `rounded-panel`, `1px` `border-border`, **no shadow**, no browser or OS chrome                                                                                                                                                                                                  |
| Background | The frame is always `bg-background` paper, **in both themes**. A light UI capture on a dark page looks pasted on; a paper plate reads as deliberate.                                                                                                                            |
| Alt text   | Describe what is on screen, in the page's language. Never `alt=""` on a proof image.                                                                                                                                                                                            |
| Caption    | Optional, mono, one line, and factual. No invented metrics under a real screenshot.                                                                                                                                                                                             |

Placement: one dominant shot in the hero rail, one in the features split, and at most one
full-bleed band. More than three competes with the claim instead of supporting it.

Most of these exist in the current page; the ones already removed stay removed. None may
return.

1. Blurred gradient blobs behind the hero.
2. A sparkles-icon badge above the h1.
3. Three or four equal cards as the only presentation of a feature set (the Two modes rule).
4. Rainbow icon tints. One accent per page, not one per icon.
5. Gradient text, glassmorphism, side-stripe borders.
6. Counters the product cannot measure.
7. Centered hero + centered section + centered CTA, start to finish.
8. "AI-powered" as an adjective in a badge.
9. A `Card` that only wraps another `Card`, or a section component that renames a div.

## Token migration

Everything lands in `apps/web/src/app/globals.css` (`:root`, `.dark`, `@theme inline`).

| Token                          | Light                       | Dark                        |
| ------------------------------ | --------------------------- | --------------------------- |
| `--background`                 | `0.972 0.014 85`            | `0.155 0.035 264`           |
| `--foreground`                 | `0.175 0.022 264`           | `0.960 0.006 85`            |
| `--card`                       | `0.985 0.006 85`            | `0.215 0.022 264`           |
| `--card-foreground`            | `var(--foreground)`         | `var(--foreground)`         |
| `--popover`                    | `0.985 0.006 85`            | `0.215 0.022 264`           |
| `--popover-foreground`         | `var(--foreground)`         | `var(--foreground)`         |
| `--primary`                    | `0.455 0.215 264`           | `0.680 0.150 264`           |
| `--primary-foreground`         | `0.972 0.014 85`            | `0.175 0.022 264`           |
| `--secondary`                  | `0.905 0.012 85`            | `0.265 0.025 264`           |
| `--secondary-foreground`       | `0.450 0.020 264`           | `0.900 0.010 85`            |
| `--muted`                      | `0.945 0.016 85`            | `0.240 0.025 264`           |
| `--muted-foreground`           | `0.470 0.020 264`           | `0.720 0.020 264`           |
| `--accent`                     | `0.930 0.012 85`            | `0.265 0.028 264`           |
| `--accent-foreground`          | `var(--foreground)`         | `var(--foreground)`         |
| `--destructive`                | `0.560 0.185 27.325`        | `0.620 0.180 27.325`        |
| `--destructive-foreground`     | `0.972 0.014 85`            | `0.175 0.022 264`           |
| `--success`                    | `0.505 0.100 155`           | `0.720 0.130 155`           |
| `--warning`                    | `0.530 0.100 75`            | `0.780 0.125 75`            |
| `--info`                       | `var(--primary)`            | `var(--primary)`            |
| `--border`                     | `0.880 0.012 85`            | `0.300 0.025 264`           |
| `--input`                      | `0.630 0.020 264`           | `0.520 0.025 264`           |
| `--ring`                       | `0.455 0.215 264`           | `0.680 0.150 264`           |
| `--sidebar`                    | `0.985 0.006 85`            | `0.190 0.030 264`           |
| `--sidebar-foreground`         | `var(--foreground)`         | `var(--foreground)`         |
| `--sidebar-primary`            | `var(--primary)`            | `var(--primary)`            |
| `--sidebar-primary-foreground` | `var(--primary-foreground)` | `var(--primary-foreground)` |
| `--sidebar-accent`             | `0.930 0.012 85`            | `0.265 0.028 264`           |
| `--sidebar-accent-foreground`  | `var(--foreground)`         | `var(--foreground)`         |
| `--sidebar-border`             | `var(--border)`             | `var(--border)`             |
| `--sidebar-ring`               | `var(--ring)`               | `var(--ring)`               |
| `--signal`                     | `0.880 0.210 122`           | `0.880 0.210 122`           |
| `--signal-foreground`          | `0.175 0.022 264`           | `0.175 0.022 264`           |
| `--cobalt-hover`               | `0.560 0.200 264`           | `0.620 0.170 264`           |

`--radius` is **not** in this table on purpose (§Shape). `--brand-accent` keeps pointing at
`--primary` and follows cobalt automatically; `--brand-accent-soft` mixes into `--accent`,
which is now a warm neutral, so org branding stays coherent.

Additions to `@theme inline` (none of these exist today, so `bg-signal` silently does
nothing until they are declared):

- `--color-signal`, `--color-success`, `--color-warning`, `--color-info`
- `--radius-control`, `--radius-card`, `--radius-panel`
- `--font-display`
- `--default-transition-duration`, `--default-transition-timing-function`
- `--chart-1` … `--chart-5`

**Do not map `--signal` onto `--accent`.** `--accent` is the hover surface in 15 of the 60
kit components and in 39 files app-wide; pointing it at the accent paints every menu row
acid lime. `--signal` is a new token consumed by exactly three utilities: `bg-signal`,
`ring-signal`, and a `border-b-signal` underline. `text-signal` on `paper` is forbidden.

### Known residue outside this scope

Removing the old identity from the code is not finished by changing tokens, and these are
deliberately not in this PR:

- `oklch(0.546 0.245 265)` is hardcoded in five chart files
  (`stats/daily-activity-chart.tsx:59,87`, `stats/state-breakdown-chart.tsx:14`,
  `stats/study-time-card.tsx:104`, `edu/dashboard/group-performance-card.tsx:70`). They
  should read `var(--chart-1)`.
- 61 hardcoded `violet-/indigo-/cyan-/purple-` utilities across 11 files, including
  `packages/ui/src/components/ui/stat-card.tsx`.
- 27 arbitrary font sizes (`text-[11px]`×10, `text-[10px]`×10, `text-[15px]`×4, …).
- `session-summary-dialog.tsx:78` calls `hsl(var(--chart-2))` on a token that does not
  exist; `hsl()` around an OKLCH token is invalid CSS.
- The kit's focus ring is `ring-[3px] ring-ring/50`, and cobalt at 50% over paper measures
  **2.45:1**, below the 3:1 that 1.4.11 requires. Marketing components use a solid ring;
  fixing the kit is its own change.

## Accessibility floor

- Body text ≥ 4.5:1, large text ≥ 3:1.
- Decorative rules are exempt from any minimum; anything carrying control identity is
  ≥ 3:1 (§Boundaries).
- One `<h1>` per page, no skipped heading levels.
- **Touch targets ≥ 24×24 CSS px (WCAG 2.5.8 AA), and ≥ 44×44 for any primary CTA.** The
  kit's `size="lg"` is `h-10` (40px), so `CtaButton` declares its own `2.75rem` height
  rather than calling it 44px and shipping 40. The 44px figure is AAA (2.5.5), not AA;
  say which.
- Focus visible everywhere: solid `ring` (not `/50`), `2px`, with a `2px` offset. Never
  `outline: none`.
- Links in body copy are distinguished by underline or weight, not colour alone.
- Every motion respects `prefers-reduced-motion`.

## Open decisions

1. **Dark parity timing.** Tokens for both modes are specified here. Dark is **live today**
   for anyone with a dark OS (`defaultTheme="system"`), so deferring it means shipping the
   current violet-on-slate until it is done.
2. **Marketing layout shell.** Required before full-bleed bands exist.
