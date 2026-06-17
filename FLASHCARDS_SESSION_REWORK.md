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

### ✅ Phase 1 — Renames + fix cram SM-2 **(DONE)**

**Delete old route directories and create new ones:**
- `src/app/(frontend)/app/flashcards/study/` → deleted, replaced with `review/`
- `src/app/(frontend)/app/flashcards/practice/` → deleted, replaced with `cram/`
- `src/app/(backend)/api/v1/flashcards/practice/history/` → directory didn't exist, skipped
- `src/app/(frontend)/app/flashcards/session/` — kept, updated internally

**Session mode strings:**
- `mode=study` → `mode=review`
- `mode=practice` → `mode=cram`
- `mode=quick` — kept as shorthand for review with limit=5

**Fix cram mode SM-2 persistence:**
- `session-client.tsx`: Removed all local SM-2 logic (`localSM2`, `calculateSM2`, priority re-queue). Cram mode calls same `POST /batch/practice` as review mode.
- Cram mode still fetches all cards via `GET /practice/prepare` but logs answers server-side.

**Delete dead code:**
- `flashcard-practice.controller.ts`: Removed `getHistory()` and `getHistoryForFlashcard()` methods (both returned `[]` stubs)
- `[id]/practice/route.ts` GET handler removed
- `practice/route.ts` GET handler deprecated (returns empty array)

**Rename labels:**
- `src/app/(frontend)/app/page.tsx` — "Quick Practice" → "Quick Review"
- `src/components/flashcards/session-summary-dialog.tsx` — mode check updated (`practice`→`cram`)
- `src/app/(frontend)/app/flashcards/deck/[deckId]/deck-client.tsx` — `mode=practice`→`mode=cram`
- i18n message files: keys renamed, old keys removed

### ✅ Phase 2 — Database migrations **(DONE)**

**Decisions made during implementation:**
- `learning_state` as column name (not `card_state`) — explicit about learning lifecycle phase, no overlap with DB row semantics
- Daily cap tracking handled in service layer (Phase 4), not in RPC — RPC just receives `p_new_card_limit` param
- All migrations backward-compatible with Phase 1 code (new columns have defaults, no column drops)
- `learning_step` = 0-based index into `learning_steps[]` (minute durations)
- `'new'` included in CHECK constraint for future use but `DEFAULT 'review'` — cards with no review state row are implicitly "new", the RPC detects them via NULL `learning_state`

**Migration 1: `20260620000001_extend_review_state.sql`**
- Drops `flashcard_review_state_last_quality_check` constraint
- Adds `learning_state text CHECK (...)` DEFAULT `'review'`
- Adds `learning_step integer` DEFAULT 0
- Adds `lapse_count integer` DEFAULT 0
- Adds `is_leech boolean` DEFAULT false

**Migration 2: `20260620000002_user_study_settings.sql`**
- New table: `user_study_settings` with RLS policies
- Columns: `user_id` (PK), `learning_steps` (DEFAULT `'{1,10}'`), `new_cards_per_day` (20), `leech_threshold` (8), `new_cards_introduced` (0), `daily_reset_date` (CURRENT_DATE)

**Migration 3: `20260620000003_update_study_sessions_check.sql`**
- Drops old `CHECK (mode IN ('study', 'practice', 'quick'))`
- Adds `CHECK (mode IN ('review', 'cram', 'quick'))`

**Migration 4: `20260620000004_rewrite_get_due_flashcards.sql`**
- RPC now returns cards in order: learning → review → new → fallback
- New optional param `p_new_card_limit INTEGER DEFAULT 5`
- New cards detected via NULL `learning_state` (no review state row)
- Output JSON includes new fields: `learningState`, `learningStep`, `lapseCount`, `isLeech`

**Schema files:**
- `supabase/schemas/46_flashcard_review_state.sql` — columns added, constraint removed, comments added
- `supabase/schemas/47_flashcard_study_sessions.sql` — mode CHECK updated
- `supabase/schemas/48_user_study_settings.sql` — **NEW**

**Model files:**
- `src/server/models/study-settings.model.ts` — **NEW**: `UserStudySettingsSchema` + type
- `src/server/models/flashcard-practice.model.ts` — `ReviewStateSchema` extended with `learningState`, `learningStep`, `lapseCount`, `isLeech`
- `src/server/models/index.ts` — exports added

**Service file:**
- `flashcard-practice.service.ts` — `getCardsForPractice()` selects and maps new columns

### ✅ Phase 3 — SM-2 service: learning steps **(DONE)**

**`src/server/services/flashcard-spaced-repetition.service.ts`**

Rewritten `calculateNextReview()` to branch on `learningState`:

| State | Logic |
|-------|-------|
| `new` | Start learning at step 0. Delay = `learning_steps[0]` minutes. Set `learningState = 'learning'` |
| `learning` | Advance/regress steps based on rating. If last step + Good → graduate: `learningState = 'review'`, `interval = 1 day`, `repetitions = 1` |
| `review` | Existing SM-2 (unchanged). Rating 1 (Again) → lapse into relearning. |
| `relearning` | Same step logic as learning. Last step + Good → `learningState = 'review'` |

**Rating meanings per state:**

| Button | New/Learning | Review | Relearning |
|--------|-------------|--------|------------|
| Again (1) | Back to step 0 | Lapse → `lapse_count++`, `learningState = 'relearning'`, step 0 | Back to step 0 |
| Hard (2) | Stay on step, 1.5× delay | SM-2 hard (quality=2) | Stay on step, 1.5× delay |
| Good (3) | Next step. Last step → graduate | SM-2 good (quality=3) | Next step. Last → review |
| Easy (4) | Graduate immediately (1d interval) | SM-2 easy (quality=5) | Return to review |

**Model types moved to `flashcard-spaced-repetition.model.ts`:**
- `LearningState`, `Rating`, `IntervalUnit` type aliases
- `CalculateNextReviewInput` / `CalculateNextReviewOutput` interfaces

**`checkLeech(lapseCount, threshold)`** — simple threshold check, returns boolean.

**Rate limiting:** `rating` (1-4) replaces the old `wasCorrect`+`confidenceLevel` → quality mapping. For review state, rating maps directly to SM-2 quality (1→0, 2→2, 3→3, 4→5). For learning states, rating directly controls step advancement.

**`flashcard-practice.service.ts` — `upsertReviewState()`:**
- Now reads `learning_state`, `learning_step`, `lapse_count`, `is_leech` from existing state
- Ensures `user_study_settings` row exists (creates defaults if missing)
- Maps `confidenceLevel` → `rating` (clamped 1-4, defaults to 3)
- Calls new `calculateNextReview()` with full input
- Writes all 11 columns back

**Fixed vitest.config.ts include glob** (typo: `__test__` → `__tests__`)

### ✅ Phase 4 — Practice service: daily caps + leech response **(DONE)**

**`src/server/services/flashcard-practice.service.ts`**

- **`resetDailyIfNeeded(ctx)`** — new private method; checks `daily_reset_date`, resets `new_cards_introduced=0` if stale
- **`getDueCards()`** — calls `resetDailyIfNeeded`, computes cap as `max(0, new_cards_per_day - new_cards_introduced)`, passes to RPC, increments `new_cards_introduced` after serving new cards
- **`getDueBreakdown()` / `getDueCount()`** — filter changed from `!state || past_due` to `state && past_due`, excluding new cards (no review state) from due counts
- **`batch()`** — response shape changed from `{ success, updated }` to `{ success, results: [{ flashcardId, isLeech }] }`, captures `is_leech` from each `upsertReviewState()` call

### ✅ Phase 5 — Session UI **(DONE)**

**`src/app/(frontend)/app/flashcards/session/session-client.tsx`**

- Full rewrite adding card state awareness to the session UI
- **Card state badge**: Shows current learning state — `New`, `Learning`, `Relearning`, `Review`, or `Leech` (with Brain icon)
- **Leech detection dialog**: `AlertDialog` shown when a card's `isLeech` flag is detected. Offers "Suspend" (adds `suspendedIdsRef`, filters card from `visibleCards`, advances) or "Keep Going"
- **Step indicator**: Text below card showing `"Step 1 of 2"` etc., only visible during `learning`/`relearning` states
- **Learning-aware rating button labels**: When card is in learning/relearning/new state, buttons show: `Again (1m)`, `Hard (3m)`, `Good (5m)`, `Easy (10m)`. Review state uses plain labels unchanged.
- **Suspended cards**: `suspendedIdsRef` set tracks suspended cards; `visibleCards` memo filters them; `advanceCard` skips suspended entries
- **`reviewState` passthrough**: Uses `Record<string, unknown>` to avoid narrowing API fields on the client

**`src/components/flashcards/session-summary-dialog.tsx`**
- Per-mode button labels: `practice_again_review` / `practice_again_cram` / `practice_again_quick` and `back_review` / `back_cram` / `back_quick`
- Mode key resolved from `data.mode` string

**`src/app/(frontend)/app/flashcards/session/page.tsx`**
- Inline type for mapped flashcards changed to `Record<string, unknown> | null` for `reviewState`

**i18n keys added (en.json + pl.json):**
- `card_state_new`, `card_state_learning`, `card_state_relearning`, `card_state_review`, `card_state_leech`
- `leech_dialog_title`, `leech_dialog_description`, `leech_suspend`, `leech_keep`
- `step_indicator`
- `rating_again_learning`, `rating_hard_learning`, `rating_good_learning`, `rating_easy_learning`
- `practice_again_review`, `practice_again_cram`, `practice_again_quick`
- `back_review`, `back_cram`, `back_quick`

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

| Action | File | Phase |
|--------|------|-------|
| ~~DELETE~~ | ~~`src/app/(frontend)/app/flashcards/study/`~~ | **1 ✅** |
| ~~DELETE~~ | ~~`src/app/(frontend)/app/flashcards/practice/`~~ | **1 ✅** |
| ~~DELETE~~ | ~~`src/app/(backend)/api/v1/flashcards/practice/history/`~~ | N/A (didn't exist) |
| ~~**NEW**~~ | ~~`supabase/migrations/20260620000001_extend_review_state.sql`~~ | **2 ✅** |
| ~~**NEW**~~ | ~~`supabase/migrations/20260620000002_user_study_settings.sql`~~ | **2 ✅** |
| ~~**NEW**~~ | ~~`supabase/migrations/20260620000003_update_study_sessions_check.sql`~~ | **2 ✅** |
| ~~**NEW**~~ | ~~`supabase/migrations/20260620000004_rewrite_get_due_flashcards.sql`~~ | **2 ✅** |
| ~~**NEW**~~ | ~~`supabase/schemas/48_user_study_settings.sql`~~ | **2 ✅** |
| NEW | `src/app/(frontend)/app/flashcards/study/page.tsx` | 6 |
| NEW | `src/app/(frontend)/app/flashcards/study/study-client.tsx` | 6 |
| ~~**NEW**~~ | ~~`src/server/models/study-settings.model.ts`~~ | **2 ✅** |
| ~~**EDIT**~~ | ~~`supabase/schemas/46_flashcard_review_state.sql`~~ | **2 ✅** |
| ~~**EDIT**~~ | ~~`supabase/schemas/47_flashcard_study_sessions.sql`~~ | **2 ✅** |
| ~~**EDIT**~~ | ~~`src/server/models/flashcard-spaced-repetition.model.ts`~~ | **3 ✅** |
| ~~**EDIT**~~ | ~~`src/server/services/flashcard-spaced-repetition.service.ts`~~ | **3 ✅** |
| ~~**EDIT**~~ | ~~`src/server/services/flashcard-practice.service.ts`~~ | **2 ✅**, **4 ✅** |
| ~~**EDIT**~~ | ~~`src/server/controllers/flashcard-practice.controller.ts`~~ | **1 ✅** |
| ~~**EDIT**~~ | ~~`src/server/models/flashcard-practice.model.ts`~~ | **1 ✅**, **2 ✅** |
| ~~**EDIT**~~ | ~~`src/server/models/index.ts`~~ | **2 ✅** |
| ~~**EDIT**~~ | ~~`__tests__/unit/services/flashcard-practice.service.test.ts`~~ | **4 ✅** |
| **EDIT** | `src/app/(frontend)/app/flashcards/session/session-client.tsx` | 1 ✅, **5 ✅** |
| **EDIT** | `src/app/(frontend)/app/flashcards/session/page.tsx` | 1 ✅, **5 ✅** |
| **EDIT** | `src/app/(frontend)/app/page.tsx` | 1 ✅ |
| **RENAME** | `study/` → `review/` (dir + page.tsx + client) | 1 ✅ |
| **RENAME** | `practice/` → `cram/` (dir + page.tsx + client) | 1 ✅ |
| **RENAME** | `mode=study` → `mode=review` (model enum) | 1 ✅ |
| **RENAME** | `mode=practice` → `mode=cram` (model enum) | 1 ✅ |
| **EDIT** | `src/components/flashcards/session-summary-dialog.tsx` | 1 ✅, **5 ✅** |
| **EDIT** | `src/config/breadcrumbs.ts` | 1 ✅ |
| **EDIT** | `src/app/(frontend)/app/flashcards/flashcards-client.tsx` | 1 ✅ |
| **EDIT** | `src/app/(frontend)/app/flashcards/deck/[deckId]/deck-client.tsx` | 1 ✅ |
| **EDIT** | `src/i18n/messages/en.json` | 1 ✅, **5 ✅** |
| **EDIT** | `src/i18n/messages/pl.json` | 1 ✅, **5 ✅** |
