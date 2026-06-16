# Flashcards Session Rework

Comprehensive overhaul of the flashcards session flow: learning steps, daily caps, leech detection, renamed entry points, and fixed SM-2 persistence in cram mode.

**No backward compatibility layers.** Old routes, modes, and code are deleted, not aliased.

---

## Current State vs Target

| Aspect | Current | Target |
|--------|---------|--------|
| Session modes | `study` (due cards, server SM-2), `practice` (all cards, client SM-2), `quick` (5 cards) | `review` (due cards), `cram` (all cards in a deck), `learn` (new cards, daily capped) |
| SM-2 in cram mode | Client-side, ephemeral | Server-side, persisted same as review |
| New cards | Go straight into review queue | Graduate through learning steps (1min → 10min → graduate) |
| Daily new card cap | None | Configurable (default 20), resets daily |
| Leech detection | None | Lapse counter + threshold → flag/suspend |
| UI labels | "Study Mode", "Practice", "Quick Practice" | "Review Due", "Cram", "Quick Review" |
| Entry points | Two dashboard panels + app homepage | One unified study page with tabs |

---

## Phases

### Phase 1 — Renames + fix cram SM-2

**Delete old route directories and create new ones:**
- `src/app/(frontend)/app/flashcards/study/` → delete, replace with `review/`
- `src/app/(frontend)/app/flashcards/practice/` → delete, replace with `cram/`
- `src/app/(backend)/api/v1/flashcards/practice/history/` → delete entire dir
- `src/app/(frontend)/app/flashcards/session/` — keep, update internally

**Session mode strings:**
- `mode=study` → `mode=review`
- `mode=practice` → `mode=cram`
- `mode=quick` — keep as shorthand for review with limit=5

**Fix cram mode SM-2 persistence:**
- `session-client.tsx`: Remove all local SM-2 logic (`localSM2`, `calculateSM2`, priority re-queue). Cram mode calls same `POST /batch/practice` as review mode.
- Cram mode still fetches all cards via `GET /practice/prepare` but logs answers server-side.

**Delete dead code:**
- `flashcard-practice.controller.ts`: Remove `getHistory()` and `getHistoryForFlashcard()` methods (both return `[]` stubs)

**Rename labels:**
- `src/components/flashcards/dashboard-panel.tsx` — "Study Mode" → "Review Due", "Practice" → "Cram"
- `src/app/(frontend)/app/page.tsx` — "Quick Practice" → "Quick Review"
- i18n message files: update keys, delete old ones

### Phase 2 — Database migrations

**Migration 1: extend `flashcard_review_state`**

```sql
ALTER TABLE public.flashcard_review_state DROP CONSTRAINT flashcard_review_state_last_quality_check;
ALTER TABLE public.flashcard_review_state
  ADD COLUMN card_state      text NOT NULL DEFAULT 'review'
              CHECK (card_state IN ('new', 'learning', 'review', 'relearning')),
  ADD COLUMN learning_step   integer NOT NULL DEFAULT 0,
  ADD COLUMN lapse_count     integer NOT NULL DEFAULT 0,
  ADD COLUMN is_leech        boolean NOT NULL DEFAULT false;
```

Existing rows get `card_state = 'review'` (they have nonzero intervals).

**Migration 2: user study settings table**

```sql
CREATE TABLE public.user_study_settings (
  user_id                uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  learning_steps         integer[] NOT NULL DEFAULT '{1,10}',
  new_cards_per_day      integer NOT NULL DEFAULT 20,
  leech_threshold        integer NOT NULL DEFAULT 8,
  new_cards_introduced   integer NOT NULL DEFAULT 0,
  daily_reset_date       date NOT NULL DEFAULT CURRENT_DATE
);
```

**Migration 3: rewrite `get_due_flashcards` RPC**

Rewrite the PL/pgSQL function to:
1. Return learning cards first (sorted by `next_review_at` ASC)
2. Return review cards where `next_review_at <= NOW()` (sorted ASC)
3. Return new cards up to `new_cards_per_day - new_cards_introduced_today` (sorted by `created_at` ASC, oldest first)
4. Fallback: worst-quality review cards when nothing is due
5. Increment `new_cards_introduced` on `user_study_settings` when serving new cards

**Schema files:**
- `supabase/schemas/46_flashcard_review_state.sql` — replace with new columns
- `supabase/schemas/48_user_study_settings.sql` — new file

### Phase 3 — SM-2 service: learning steps

**`src/server/services/flashcard-spaced-repetition.service.ts`**

Rewrite `calculateNextReview()` to branch on `card_state`:

| State | Logic |
|-------|-------|
| `new` | Start learning at step 0. Delay = `learning_steps[0]` minutes. Set `card_state = 'learning'` |
| `learning` | Advance/regress steps based on rating. If last step + Good → graduate: `card_state = 'review'`, `interval = 1 day`, `repetitions = 1` |
| `review` | Existing SM-2 (unchanged) |
| `relearning` | Same step logic as learning. Last step + Good → `card_state = 'review'` |

**Rating meanings per state:**

| Button | New/Learning | Review | Relearning |
|--------|-------------|--------|------------|
| Again (1) | Back to step 0 | Lapse → `lapse_count++`, card_state = 'relearning', step 0 | Back to step 0 |
| Hard (2) | Stay on step, 1.5× delay | SM-2 hard (quality=2) | Stay on step, 1.5× delay |
| Good (3) | Next step. Last step → graduate | SM-2 good (quality=3) | Next step. Last → review |
| Easy (4) | Graduate immediately (1d interval) | SM-2 easy (quality=5) | Return to review |

**Input changes to `calculateNextReview()`:**
```typescript
type CalculateNextReviewInput = {
  cardState: 'new' | 'learning' | 'review' | 'relearning';
  currentStep: number;
  learningSteps: number[];
  wasCorrect: boolean;
  confidenceLevel: number;
  easinessFactor: number;
  interval: number;
  repetitions: number;
};
```

**Output changes:**
```typescript
type CalculateNextReviewOutput = {
  cardState: 'learning' | 'review' | 'relearning';
  learningStep: number;
  newEasinessFactor: number;
  newInterval: number;
  newRepetitions: number;
  nextReviewAt: Date;
  intervalUnit: 'minutes' | 'days';
  isLeech: boolean;
};
```

**New method `checkLeech(lapseCount, threshold)`** — simple threshold check, returns boolean.

### Phase 4 — Practice service: daily caps + leech

**`src/server/services/flashcard-practice.service.ts`**

- `getDueCards()`: Before querying, call `resetDailyIfNeeded(userId)` that resets `new_cards_introduced` when `daily_reset_date < CURRENT_DATE`. Pass remaining new card budget to RPC.
- `log()` and `batch()`: After wrong answer, call `checkLeech()`, set `is_leech = true` on review state if threshold hit, include `isLeech` in response.
- Remove all local/client SM-2 references (cram mode now uses server).

**`src/server/controllers/flashcard-practice.controller.ts`**
- Remove `getHistory()` and `getHistoryForFlashcard()` methods
- Handle `isLeech` in response from service

### Phase 5 — Session UI

**`src/app/(frontend)/app/flashcards/session/session-client.tsx`**

- Remove `localSM2`, `calculateSM2()`, priority re-queue logic
- Remove `useRef` usage for local SM-2 state
- Add card state badge: `"New"` / `"Learning 1/2"` / `"Review"` / `"Relearning"` / `"Leech ⚠️"`
- Leech warning dialog: shown once when `isLeech` comes back from API. Offers "Suspend" (skips card for rest of session) or "Keep Going"
- Learning step progress indicator below rating buttons: `"Step 1 of 2"` with dot indicator
- Rating button labels change based on card state:
  - Learning: "Again (restart)", "Hard (stay)", "Good (next step)", "Easy (graduate)"
  - Review: "Again", "Hard", "Good", "Easy" (unchanged)

**`src/components/flashcards/session-summary-dialog.tsx`**
- Add "New cards learned" count
- Change "Practice Again" → "Review Again" / "Cram Again"

### Phase 6 — Unified study page

Replace the two separate setup pages with one. Delete:
- `src/app/(frontend)/app/flashcards/study/`
- `src/app/(frontend)/app/flashcards/practice/`

Create `src/app/(frontend)/app/flashcards/study/page.tsx` + `study-client.tsx` with three tabs:

1. **Review Due** — shows due count. Pick topics/decks filter. "Start Review" → `/app/flashcards/session?mode=review&...`
2. **Learn New** — shows remaining new cards today (daily cap − introduced). "Start Learning" → `/app/flashcards/session?mode=review&new=true`
3. **Cram Deck** — pick a single deck. "Start Cramming" → `/app/flashcards/session?mode=cram&deckId=...`

---

## File Inventory

| Action | File |
|--------|------|
| **DELETE** | `src/app/(frontend)/app/flashcards/study/` |
| **DELETE** | `src/app/(frontend)/app/flashcards/practice/` |
| **DELETE** | `src/app/(backend)/api/v1/flashcards/practice/history/` |
| **NEW** | `supabase/migrations/YYYYMMDDHHMMSS_learning_steps.sql` |
| **NEW** | `supabase/migrations/YYYYMMDDHHMMSS_user_study_settings.sql` |
| **NEW** | `supabase/migrations/YYYYMMDDHHMMSS_update_get_due_flashcards.sql` |
| **NEW** | `supabase/schemas/48_user_study_settings.sql` |
| **NEW** | `src/app/(frontend)/app/flashcards/study/page.tsx` |
| **NEW** | `src/app/(frontend)/app/flashcards/study/study-client.tsx` |
| **NEW** | `src/server/models/study-settings.model.ts` |
| **EDIT** | `supabase/schemas/46_flashcard_review_state.sql` |
| **EDIT** | `src/server/models/flashcard-spaced-repetition.model.ts` |
| **EDIT** | `src/server/services/flashcard-spaced-repetition.service.ts` |
| **EDIT** | `src/server/services/flashcard-practice.service.ts` |
| **EDIT** | `src/server/controllers/flashcard-practice.controller.ts` |
| **EDIT** | `src/app/(frontend)/app/flashcards/session/session-client.tsx` |
| **EDIT** | `src/app/(frontend)/app/flashcards/session/page.tsx` |
| **EDIT** | `src/app/(frontend)/app/page.tsx` |
| **EDIT** | `src/components/flashcards/dashboard-panel.tsx` |
| **EDIT** | `src/components/flashcards/session-summary-dialog.tsx` |
| **EDIT** | `src/i18n/messages/en.json` |
| **EDIT** | `src/i18n/messages/pl.json` |
