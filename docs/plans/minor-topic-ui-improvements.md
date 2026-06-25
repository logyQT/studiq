# Minor Topic UI Improvements

## Goal
Bring topic management UI to visual parity with deck management UI.

---

## Pre-requisite: Refactor `color-utils.ts`

The current color system is split (12 deck gradients vs 10 topic solid colors) with a weak hash. Unify and expand to 300+ gradient combos before any component changes.

### Seed colours and shades
```typescript
const HUES = [
  'red', 'orange', 'amber', 'yellow', 'lime',
  'green', 'emerald', 'teal', 'cyan', 'sky',
  'blue', 'indigo', 'violet', 'purple',
  'fuchsia', 'pink', 'rose',
];
const SHADES = [400, 500, 600, 700];
```

### Gradient generation (module load — not hardcoded)
Two families of combos:
1. **Same hue, different shade** — `from-red-400 to-red-700` (17 × 4 × 3 = 204)
2. **Adjacent hue** — `from-red-500 to-orange-600` (17 × 2 × 4 × 4 = 544)

Both summed yields well over 300. Using every pair gives ~748 combos; to land closer to 300, sample a subset or define an explicit curated list (e.g. every `SHADE × SHADE` combo for same-hue, and one `SHADE` combo per adjacent pair).

```
GRADIENTS: string[]   // generated array of 'from-{hue}-{shade} to-{hue}-{shade}'
```

### Improved hash (FNV-1a)
Replaces the current DJB2 variant for better distribution on short strings (topic names are often 1–3 words):
```typescript
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
```

### Updated `TAILWIND_COLORS` map
Grow the hex lookup to cover all needed `{hue}-{shade}` entries for the gradient palette (17 hues × 4 shades = 68 entries instead of the current 22).

### Unified public API
```typescript
// Replaces old getGradient — uses FNV-1a + expanded GRADIENTS
getGradient(id: string): string

// Returns { from, to } hex — unchanged signature, new engine underneath
getGradientHex(id: string): { from: string; to: string }

// Returns a single Tailwind bg class derived from the same gradient palette
// (e.g. extracts the 'from' hue as solid color)
getTopicColor(name: string): string       // e.g. 'bg-red-500'

// Returns hex from getTopicColor
getTopicColorHex(name: string): string
```

`getTopicColor` now delegates to the unified gradient pool instead of the old 10-entry `TOPIC_COLORS` array. Backward compatible — all existing callers (DeckCard, topic-view-dialog, etc.) continue to work unchanged.

### Migration plan
1. Replace `GRADIENTS` constant with generated array
2. Add `fnv1a` hash function
3. Update `getGradient` to use `fnv1a`
4. Expand `TAILWIND_COLORS` map to cover all hue+shade combos
5. Reimplement `TOPIC_COLORS` and `getTopicColor` to derive from the unified pool
6. Remove old `TOPIC_COLORS` constant, old hash functions
7. Verify with `bun run lint` — zero changes expected in consumers

---

## Files Changed

### 1. TopicCard (`cards/topic-card.tsx`)
- **Hover effects**: `sm:hover:-translate-y-1 sm:hover:shadow-lg sm:hover:border-primary/40` with `duration-300 ease-out`
- **Card layout**: `flex flex-col h-full overflow-hidden max-sm:py-0 min-w-0 p-0`
- **Icon**: Replace colored letter circle with gradient SVG tag icon using `getGradientHex(topic.name)` — same pattern as DeckCard's folder icon
- **Mobile row**: `flex items-center gap-3 p-3.5 sm:hidden` with icon, name, badge, dropdown menu
- **Desktop card**: `hidden sm:flex flex-col flex-1 p-5 relative` with icon+name header, flexible body, badge + "View" button footer
- **New imports**: `ArrowRight`, `Eye`, `MoreVertical` from `lucide-react`, `DropdownMenu*` components, `getGradientHex`
- **Removed**: `getTopicColor` (replaced by `getGradientHex` for icon)

### 2. Skeleton (`topic-management-screen.tsx` lines ~206-225)
Replace with mobile + desktop skeleton matching new TopicCard layout:
```
Mobile: Skeleton icon → Skeleton name + badge → Skeleton menu button
Desktop: Skeleton icon + name → flex-1 spacer → Skeleton badge + button
```

### 3. TopicFormDialog (`shared/topic-form-dialog.tsx`)
- **Wrapper**: Wrap content in `<Card className="p-5 pb-3">` with gradient tag icon + borderless input (same pattern as `DeckFormDialog`)
- **Icon**: Tag SVG with `getGradientHex(editing?.name ?? 'dialog')`
- **Input**: `text-lg font-bold tracking-tight h-auto py-0 px-0 border-0 border-b rounded-none focus-visible:ring-0 focus-visible:border-primary`
- **New imports**: `Card` from `@/components/ui/card`, `getGradientHex` from `@/lib/color-utils`
- **Removed**: `Label` (replaced by `sr-only` label)

### 4. Search/filter (`topic-management-screen.tsx`)
- Add `searchInput` + `debouncedSearch` state (same pattern as deck management)
- Filter topics client-side: `topics?.filter(t => t.name.toLowerCase().includes(debouncedSearch))`
- Render search input above grid: `relative max-w-md` with `Search` icon + clear button
- **New imports**: `Search`, `X` from `lucide-react`, `useDebounce` from `@/hooks/use-debounce`
- **New i18n key**: `search_topics` in `AppFlashcardTopicsPage` and `EduFlashcardTopicsPage` (both `en.json` and `pl.json`)

### 5. Topic color dot (`cards/topic-card.tsx`)
Add colored dot next to topic name in card header:
```tsx
<div className={`h-2 w-2 rounded-full shrink-0 ${getTopicColor(topic.name)}`} />
```
This is visual continuity — the dot matches the color used for topic badges elsewhere. `getTopicColor` is kept for this (only the icon changes to gradient).

### 6. TopicViewDialog (`shared/topic-view-dialog.tsx`)
- Replace the header color dot with a gradient tag SVG icon (consistent with new TopicCard)
- Add the tag SVG with gradient next to the topic name in `DialogTitle`
- **New imports**: `getGradientHex` (keep `getTopicColor` for backward compat with any inline usage)

## Translation Keys to Add
```json
// en.json
"AppFlashcardTopicsPage": { "search_topics": "Search topics..." },
"EduFlashcardTopicsPage": { "search_topics": "Search topics..." }

// pl.json
"AppFlashcardTopicsPage": { "search_topics": "Szukaj tematów..." },
"EduFlashcardTopicsPage": { "search_topics": "Szukaj tematów..." }
```

## Verification
- `bun run lint` passes (0 errors, 0 warnings)
- `GRADIENTS` array contains 300+ entries
- Topic grid renders with hover effects on desktop
- Mobile row layout renders correctly
- Create/edit topic dialog shows gradient icon + borderless input
- Search filters topics by name
- Color dot appears on topic cards
- Topic view dialog shows gradient icon in header
- Skeleton matches real card layout
