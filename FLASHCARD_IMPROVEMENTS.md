# Flashcard Domain — Improvement Roadmap

**Legend:**  
`B` = Backend (route + controller + service + model)  
`F` = Frontend (component + page)  
`M` = Database migration  

---

## Phase 1 — Foundation & Architecture ✅

*All 3 items implemented in a single pass.*

### 1.1 Batch Operations API ✅

Backend endpoints for batch flashcard operations. Required before any bulk UI.

| Endpoint | Method | Body | Permission | Behavior |
|----------|--------|------|------------|----------|
| `/api/v1/flashcards/batch/delete` | `POST` | `{ ids: string[] }` | `FLASHCARD_DELETE` per card | Fails on first card without permission |
| `/api/v1/flashcards/batch/link` | `POST` | `{ ids: string[], deckIds: string[] }` | `FLASHCARD_READ` per card + `DECK_UPDATE` per deck | Bulk upsert `flashcard_deck_assignments` |
| `/api/v1/flashcards/batch/unlink` | `POST` | `{ ids: string[], deckId: string }` | `DECK_UPDATE` on deck | Remove `flashcard_deck_assignments` rows (trigger cleans orphans) |
| `/api/v1/flashcards/batch/topics` | `POST` | `{ ids: string[], topicIds?: string[], operation: 'add'\|'remove'\|'set' }` | `FLASHCARD_UPDATE` per card | `add`: merge, `remove`: unassign, `set`: replace all |
| `/api/v1/flashcards/batch/move` | `POST` | `{ ids: string[], sourceDeckId: string, targetDeckId: string }` | `FLASHCARD_UPDATE` per card + `DECK_UPDATE` on target | Insert target deck assignment first, then delete from source deck (avoids trigger orphan race) |
| `/api/v1/flashcards/batch/copy` | `POST` | `{ ids: string[], targetDeckId: string }` | `FLASHCARD_READ` per card + `DECK_UPDATE` on target | Duplicate flashcards + topic assignments, assign copies to target deck |
| `/api/v1/flashcards/[id]/unlink` | `POST` | `{ deckId: string }` | `DECK_UPDATE` on deck | Single-flashcard unlink from deck |

**Files created/modified:**

| Layer | Files |
|-------|-------|
| Routes (new) | `src/app/(backend)/api/v1/flashcards/batch/delete/route.ts` |
| | `src/app/(backend)/api/v1/flashcards/batch/link/route.ts` |
| | `src/app/(backend)/api/v1/flashcards/batch/unlink/route.ts` |
| | `src/app/(backend)/api/v1/flashcards/batch/topics/route.ts` |
| | `src/app/(backend)/api/v1/flashcards/batch/move/route.ts` |
| | `src/app/(backend)/api/v1/flashcards/batch/copy/route.ts` |
| | `src/app/(backend)/api/v1/flashcards/[id]/unlink/route.ts` |
| Controller | `src/server/controllers/flashcard.controller.ts` — `batchDelete`, `batchLink`, `batchUnlink`, `batchTopics`, `batchMove`, `batchCopy`, `unlinkFromDeck` |
| Service | `src/server/services/flashcard.service.ts` — 7 batch methods with RBAC |
| Model | `src/server/models/flashcard.model.ts` — `BatchDeleteSchema`, `BatchLinkSchema`, `BatchUnlinkSchema`, `BatchTopicsSchema`, `BatchMoveSchema`, `BatchCopySchema`, `UnlinkFlashcardSchema` + inferred types |

**Design decisions:**
- Permission checked per card; first failure throws and aborts the batch.
- `batch/link` checks each deck once via `in()` query, not per card-deck pair.
- `batch/topics` uses 3 operations: `add` (deduped), `remove` (filtered), `set` (delete-all + insert).
- `batch/unlink` checks `DECK_UPDATE` on the deck (not flashcard ownership) — deck owner can remove cards.
- `batch/move`: insert target deck assignment first, then delete from source deck. Order avoids the orphan cleanup trigger (AFTER DELETE FOR EACH STATEMENT) deleting flashcards mid-operation.
- `batch/copy` duplicates flashcards + their topic assignments, then assigns copies to target deck. Uses `PostgrestBuilder` return to get inserted IDs.
- `[id]/unlink`: single-card variant. Checks `DECK_UPDATE` only. DB trigger `trg_flashcard_deck_assignments_cleanup` removes flashcards with zero remaining assignments.

---

### 1.2 Split DeckDetailScreen ✅

`deck-detail-screen.tsx` reduced from 1121→500 lines via 3 focused files:

```
src/components/flashcards/
├── deck-detail-screen.tsx         ← Orchestrator: queries, state, handler routing (~500 lines)
├── deck-detail-dialogs.tsx        ← All 11 dialogs via single state + handlers interface (~430 lines)
└── flashcard-card.tsx             ← Flip-card, topic badges, context menu (~180 lines)
```

**Component boundaries:**

| Component | Props | Renders |
|-----------|-------|---------|
| `FlashcardCard` | `{ fc, isFlipped, gradient, canUpdate, canDelete, topics, t, selected?, selectable?, onToggleSelect?, onFlip, onEdit, onDelete, onLink, onCopy, onAddTopic, onRemoveTopic, onViewByTopic }` | Card with flip animation, topic badges, `DropdownMenu`, opt-in selection checkbox |
| `DeckDetailDialogs` | `{ state: DialogsState, handlers: DialogsHandlers, flashcards, currentDeck, allDecks, topics, t, basePath }` | Create, Edit, Link, Copy, CopyResult, DeleteConfirm, DeckEdit, DeckDelete, ViewTopic, AddTopic, RemoveTopic, BulkDelete, BulkLink, BulkMove, BulkTopics |
| `DeckDetailScreen` | `{ deckId, backHref, basePath, apiBase, t, practiceHref? }` | Queries (4× `useApiQuery`), mutations (5× `useApiMutation`), single `DialogsState` useState, handler wiring, deck header, grid layout |

**Implementation notes:**
- Dialog state consolidated into single `DialogsState` object (was 18 separate `useState` calls, now 28 fields with batch additions).
- Handlers passed as `DialogsHandlers` interface (25 callbacks) — no inline lambdas in JSX.
- `getTopicColor` duplicated in both extracted components (single-line hash, not worth extracting).
- 15 dialogs total: 11 single-card + 4 batch (DeleteConfirm, Link, Move, Topics).

---

### 1.3 getDueCards PL/pgSQL Optimization ✅

`getDueCards` replaced a 70-line JS method (3 sequential queries + client-side sort) with a single RPC call.

**Migration:** `supabase/migrations/20260612000000_get_due_flashcards.sql`

Uses simple RBAC filter parameters (not JSONB) — the service resolves `buildQueryFilter()` to a `filterType` string (`any`/`own`/`university`) and passes it to the RPC, avoiding JSON parsing in PL/pgSQL.

**Service change:** `getDueCards` in `flashcard-practice.service.ts` now calls `supabase.rpc('get_due_flashcards', ...)` — reduced from 70 to ~30 lines.

**Parameter change:**
| Draft (doc) | Actual |
|-------------|--------|
| `p_rbac_filter JSONB` | `p_filter_type TEXT` + `p_user_id UUID` + `p_university_id UUID` |
| Service resolves filter in RPC | Service resolves via `buildQueryFilter` in JS, passes resolved params |
| Fallback as IF block after main query | Same approach — `COALESCE(due, fallback, '[]'::json)` |

**Files modified:**
- `M` `supabase/migrations/20260612000000_get_due_flashcards.sql`
- `B` `src/server/services/flashcard-practice.service.ts` — `getDueCards` rewrite

---

## Phase 2 — Student UX ✅

*Phase 2.1 completed. Remaining items not yet started.*

### 2.1 Batch Selection UI ✅

**Depends on:** Phase 1.1 (Backend batch API) — ✅ done

| Layer | Files | Changes |
|-------|-------|---------|
| `F` | `src/components/flashcards/flashcard-card.tsx` | Added `selected`/`selectable`/`onToggleSelect` props + `Checkbox` (top-left, `e.stopPropagation()`). Context menu delete calls `onDelete` only when `canDelete` (`deck.update`) — otherwise hides. View-only flashcards show delete option when user owns the deck. |
| `F` | `src/components/flashcards/flashcard-bulk-actions.tsx` | Fixed-bottom floating bar with Copy/Link/Topics/Move/Delete buttons, count display, cancel |
| `F` | `src/components/flashcards/deck-detail-dialogs.tsx` | 6 bulk dialogs: DeleteConfirm (reused), Link (checkbox deck picker), Unlink (confirmation), Copy (radio deck picker), Move (radio deck picker w/ flashcard count), Topics (add/remove/set mode toggle + topic checkboxes). All via `DialogsState`/`DialogsHandlers` bulk fields + dedicated handlers |
| `F` | `src/components/flashcards/deck-detail-screen.tsx` | `selectedIds: Set<string>` state + `isSelecting` toggle. 6 `useApiMutation` hooks with optimistic cache updates. "Select" header button + "Select All / Deselect All" toggle. `onFlip` disabled during selection. |
| `F` | `src/components/flashcards/view-only-flashcard-context-menu.tsx` | Added optional `onDelete` prop — shown when user owns the deck (`deck.update`) |
| `I` | `src/i18n/messages/en.json`, `src/i18n/messages/pl.json` | 13 original batch keys + 3 new (`select_all`, `deselect_all`, `bulk_copy`) in both `AppFlashcardDeckViewPage` and `EduDeckViewPage` namespaces |

**Files modified:**
- `src/components/flashcards/deck-detail-screen.tsx` — orchestration layer
- `src/components/flashcards/deck-detail-dialogs.tsx` — bulk dialogs
- `src/components/flashcards/flashcard-card.tsx` — selection checkbox + view-only context menu wiring
- `src/components/flashcards/view-only-flashcard-context-menu.tsx` — `onDelete` prop
- `src/i18n/messages/en.json` — 16 keys
- `src/i18n/messages/pl.json` — 16 keys

**Files created:**
- `src/components/flashcards/flashcard-bulk-actions.tsx` — floating action bar

**Optimistic updates (6 `useApiMutation` hooks + 1 single-card):**

| Mutation | Strategy | Invalidates |
|----------|----------|-------------|
| `batchDeleteCards` (now calls `batch/unlink`) | Filter out selected IDs from cache | `flashcardQueryKey`, `flashcardKeys.decks.all` |
| `batchLinkCards` | No cache change (current deck unaffected) | `flashcardKeys.decks.all` |
| `batchUnlinkCards` | Filter out unlinked IDs from cache | `flashcardQueryKey`, `flashcardKeys.decks.all` |
| `batchTopicCards` | Update `flashcard_topic_assignments` on cached cards inline (add/remove/set) | `flashcardQueryKey` |
| `batchMoveCards` | Filter out selected IDs from cache | `flashcardQueryKey`, `flashcardKeys.decks.all` |
| `batchCopyCards` | No cache change (current deck unaffected) | `flashcardQueryKey`, `flashcardKeys.decks.all` |
| `createFlashcard` | Prepend new card to cache | No invalidate (optimistic) |

All 6 batch mutations roll back on error via `onError` restoring the pre-mutation snapshot. `createFlashcard` also rolls back on error.

**Design decisions:**
- "Delete" in deck context = unlink from deck (remove `flashcard_deck_assignments` row). DB trigger cleans orphan flashcards with zero remaining assignments.
- Unlink permission checks `DECK_UPDATE` only (deck ownership), not `FLASHCARD_UPDATE`.
- Selection is a `Set<string>` local to the orchestrator, mirrored as `selectedIds: string[]` in `DialogsState` (snapshot taken when dialog opens, ensures consistent operation even if selection changes while dialog is open).
- `d.selectedIds` is used by handlers, not the live `selectedIds` Set — prevents stale-closeure bugs from async dialog flow.
- Each bulk dialog writes to dedicated bulk state fields (`bulkLinkDeckIds`, `bulkMoveTargetDeckId`, `bulkCopyTargetDeckId`, `bulkTopicIds`) via dedicated handlers — not the single-card handlers.
- `onOpenChange` callbacks properly close dialogs + clear data on cancel/backdrop-dismiss.
- `onFlip` returns empty function during selection mode — prevents card flip vs checkbox conflict.
- `clearSelection()` runs on success before toast; selection is preserved on error for retry.
- Select All / Deselect All is a single dual-toggle button (`CheckCheck` icon, outline variant). Text flips based on whether every visible card is selected.

---

### 2.2 Keyboard Shortcuts

No backend changes. Pure frontend.

| Page | Shortcut | Action |
|------|----------|--------|
| Study session (`session-client.tsx`) | `Space` | Flip card |
| | `1` | Rate "Again" |
| | `2` | Rate "Hard" |
| | `3` | Rate "Good" |
| | `4` | Rate "Easy" |
| Deck detail (`deck-detail-screen.tsx`) | `n` | New flashcard |
| | `/` | Focus search ⏳ deferred — needs 2.4 Search input |

**Implementation:** `useEffect` with `keydown` listener. `aria-keyshortcuts` attributes on card/buttons for a11y. Uses refs to avoid stale closures without re-attaching the listener. Input/textarea target guard to avoid triggering shortcuts while typing.

---

### 2.3 Session Summary ✅

| Layer | Files | Changes |
|-------|-------|---------|
| `M` | New: `supabase/migrations/20260614000000_flashcard_study_sessions.sql` | `flashcard_study_sessions` table — `id, user_id, started_at, completed_at, duration_ms, cards_studied, cards_correct, deck_ids, mode` |
| `B` | New: `POST /api/v1/flashcards/practice/sessions/complete` | Receive session summary payload, store in `flashcard_study_sessions` |
| `B` | `src/server/models/flashcard-practice.model.ts` | Add `CompleteSessionSchema` |
| `B` | `src/server/services/flashcard-practice.service.ts` | Add `completeSession` method |
| `B` | `src/server/controllers/flashcard-practice.controller.ts` | Add `completeSession` method |
| `F` | `src/app/(frontend)/app/flashcards/session/session-client.tsx` | On session end: calculate aggregate stats client-side, fire-and-forget POST to `sessions/complete`, display summary dialog |
| `F` | New: `src/components/flashcards/session-summary-dialog.tsx` | Dialog with accuracy %, cards studied, duration, cards/min, mode badge |
| `F` | `src/app/(frontend)/app/flashcards/session/page.tsx` | Parse `deckIds` from search params, pass to SessionClient |
| `F` | `src/app/(frontend)/app/flashcards/study/study-client.tsx` | Add "Statistics" button linking to `/app/flashcards/sessions` (stub) |
| `F` | `src/app/(frontend)/app/flashcards/practice/practice-client.tsx` | Add "Statistics" button linking to `/app/flashcards/sessions` (stub) |

**Deferred / out of scope for this pass:**
- Per-card breakdown (hardest/easiest cards, EF change) — requires response-time tracking per card during session, which needs additional state collection in `session-client.tsx`. Worth revisiting when per-card analytics are prioritized.
- Per-session history page (`/app/flashcards/sessions`) — the "Statistics" button links to a stub route. Building the full history page is a separate feature that reads from `flashcard_study_sessions` and shows a list of past sessions with drill-down.

---

### 2.4 Full-Text Search

| Layer | Files | Changes |
|-------|-------|---------|
| `B` | New route: `GET /api/v1/flashcards/search?q=` | Returns paginated results matching `q` against `front` or `back` |
| `B` | `src/server/services/flashcard.service.ts` | Add `search(q, ctx, limit?, offset?)` — uses `supabase.from('flashcards').textSearch('front', q)` or `ilike` |
| `B` | `src/server/controllers/flashcard.controller.ts` | Add `search` method |
| `F` | `src/components/flashcards/flashcard-search.tsx` | Search bar with debounced input, dropdown results showing front/back + deck name |
| `F` | `src/app/(frontend)/app/flashcards/page.tsx` | Add search bar to the main flashcard dashboard |

**UI pattern:** Global search bar on `/app/flashcards` dashboard. Click result navigates to the deck containing the card.

---

### 2.5 Study Streaks & Daily Goals

| Layer | Files | Changes |
|-------|-------|---------|
| `M` | New: `flashcard_streaks` table | `id, user_id, current_streak INT DEFAULT 0, longest_streak INT DEFAULT 0, last_study_date DATE, daily_goal INT DEFAULT 20, updated_at` |
| `M` | New: `flashcard_daily_progress` table | `id, user_id, study_date DATE, cards_studied INT, goal_met BOOLEAN, UNIQUE(user_id, study_date)` |
| `B` | New service: `src/server/services/flashcard-streak.service.ts` | `recordStudy(userId)` — called after each batch practice sync; `getStreak(userId)` — returns current/longest streak, today's progress, goal |
| `B` | New controller + route: `GET /api/v1/flashcards/streaks` | Returns streak data |
| `F` | `src/components/flashcards/streak-widget.tsx` | Shows 🔥 N-day streak, today's progress bar (e.g., 12/20 cards), daily goal setting |
| `F` | `src/app/(frontend)/app/flashcards/page.tsx` | Add streak widget to dashboard |

**Streak logic:**
- Study any flashcard → `recordStudy(userId)` upserts today's progress, checks if yesterday also has progress → increments/decrements streak.
- A day counts if `cards_studied >= 1` (configurable to `daily_goal`).
- Streak breaks if a day is missed (no progress for 48+ hours).

---

## Phase 3 — Card Features & Portability

*Bigger features that change what a card can be.*

### 3.1 Media in Cards

| Layer | Files | Changes |
|-------|-------|---------|
| `M` | Migration: `ALTER TABLE flashcards ADD COLUMN media jsonb` | Store `[{ type: 'image'|'audio'|'latex', url: string, alt?: string }]` |
| `B` | New route: `POST /api/v1/flashcards/media/upload` | Accept multipart file, upload to Supabase Storage (`flashcard-media/<userId>/<uuid>`), return URL |
| `B` | `src/server/models/flashcard.model.ts` | Update `CreateFlashcardSchema`, `UpdateFlashcardSchema` with optional `media` |
| `B` | `src/server/services/flashcard.service.ts` | Pass `media` through create/update |
| `F` | New: `src/components/flashcards/media-upload.tsx` | Image/audio upload with preview, drag & drop |
| `F` | `src/components/flashcards/flashcard-card.tsx` | Render images/audio/latex inside card front/back (React `dangerouslySetInnerHTML` for LaTeX via KaTeX) |

**Priority:** Images first (most requested), then LaTeX (STEM), then audio (language learning).

---

### 3.2 Cloze Deletion

| Layer | Files | Changes |
|-------|-------|---------|
| `M` | Migration: `ALTER TABLE flashcards ADD COLUMN type text DEFAULT 'basic'` | `type` can be `'basic'` or `'cloze'`. For cloze, `front` stores the cloze text with `{{c1::answer}}` markers. |
| `B` | `src/server/models/flashcard.model.ts` | Add optional `type` to create/update schemas |
| `B` | `src/server/services/flashcard.service.ts` | Pass `type` through |
| `F` | New: `src/components/flashcards/cloze-card.tsx` | Parses `{{c1::text}}` syntax, renders hidden/revealed segments, handles multiple cloze indices (`c1`, `c2`) |
| `F` | New: `src/components/flashcards/cloze-editor.tsx` | WYSIWYG-like: select text → "Cloze" button wraps in `{{c1::...}}`, auto-increments index |
| `F` | `src/components/flashcards/deck-detail-dialogs.tsx` | Type toggle in create/edit dialog (basic / cloze) |
| `F` | `src/components/flashcards/flashcard-card.tsx` | Conditionally render `ClozeCard` vs basic card |

---

### 3.3 CSV Import/Export

| Layer | Files | Changes |
|-------|-------|---------|
| `B` | New route: `POST /api/v1/flashcards/import/csv` | Parse CSV with columns `front,back[,topic,deck]`, bulk-create flashcards, return created count + errors |
| `B` | New route: `GET /api/v1/flashcards/export/csv` | Stream CSV of all readable flashcards with their topics/decks |
| `B` | New service: `src/server/services/flashcard-import.service.ts` | CSV parser: detect delimiter, validate rows, bulk-insert (reuse `bulkCreate`), collect errors |
| `F` | New: `src/components/flashcards/import-dialog.tsx` | Drag-drop or file picker, column mapping if headers present, progress indicator, error report |
| `F` | New: `src/components/flashcards/export-button.tsx` | Single button that triggers download |

**CSV format (export):**
```csv
front,back,topic,deck
"What is 2+2?","4","Math","Arithmetic"
```

**CSV format (import):** Accepts same format. Optional header row. Topics/decks are auto-created if they don't exist.

---

### 3.4 APKG Import/Export

| Layer | Files | Changes |
|-------|-------|---------|
| `B` | New package: `better-sqlite3` or `jszip` | APKG is a zip containing a SQLite DB with cards, media, deck metadata |
| `B` | New service: `src/server/services/flashcard-apkg.service.ts` | `exportApkg(userId)` — queries all cards, builds SQLite DB, zips with media files |
| `B` | New service: `src/server/services/flashcard-apkg-import.service.ts` | `importApkg(buffer)` — unzips, reads SQLite, creates cards/decks/topics, uploads media |
| `B` | New routes: `GET /api/v1/flashcards/export/apkg`, `POST /api/v1/flashcards/import/apkg` |
| `F` | `src/components/flashcards/import-dialog.tsx` | Add tab: CSV / APKG |

**Anki field mapping:**
- `Front` → `flashcards.front`
- `Back` → `flashcards.back`
- `Tags` → topics
- `Deck` → deck

---

## Phase 4 — Teacher Analytics & Data

*What teachers need for their job.*

### 4.1 Per-Student Insights

**Depends on:** Phase 1.3 (get_teacher_stats RPC)

| Layer | Files | Changes |
|-------|-------|---------|
| `B` | `src/server/services/flashcard-stats.service.ts` | Add `getStudentStats(studentId, ctx)` — accuracy, cards studied, EF, due count per student |
| `B` | New route: `GET /api/v1/flashcards/stats/teacher/students` | Returns list of students with summary stats |
| `B` | New route: `GET /api/v1/flashcards/stats/teacher/students/:id` | Returns detailed per-card stats for one student |
| `F` | New: `src/components/flashcards/stats-student-table.tsx` | Table of students with accuracy bar, cards studied, EF |
| `F` | `src/components/flashcards/stats-client.tsx` | Add student section below existing stats |

**Permission:** Only `TEACHER`, `UNIVERSITY_ADMIN`, `SYS_ADMIN`.

---

### 4.2 Period Comparison

| Layer | Files | Changes |
|-------|-------|---------|
| `B` | `src/server/models/flashcard-stats.model.ts` | Add `period` to `TeacherFlashcardStatsQuerySchema` (options: `'7d'`, `'30d'`, `'90d'`) |
| `B` | `supabase/migrations/20260613000000_teacher_stats_period.sql` | Update `get_teacher_stats` to accept period filter and return `thisPeriod` / `lastPeriod` comparison |
| `F` | `src/components/flashcards/stats-client.tsx` | Period selector dropdown, side-by-side or delta display |

**Comparison display:** Arrow indicators (↑↓) with percentage change vs previous period.

---

### 4.3 Card Versioning / Edit History

| Layer | Files | Changes |
|-------|-------|---------|
| `M` | New: `flashcard_versions` table | `id, flashcard_id, front, back, media, topic_ids, changed_by, changed_at, change_description` |
| `M` | Trigger: `on_flashcard_update` | On `flashcards` UPDATE, INSERT old row into `flashcard_versions` |
| `B` | New route: `GET /api/v1/flashcards/:id/versions` | Returns ordered list of versions |
| `B` | New route: `POST /api/v1/flashcards/:id/versions/:versionId/restore` | Restores a previous version |
| `F` | New: `src/components/flashcards/flashcard-version-history.tsx` | Dialog showing version list with diff (front/back changes highlighted) |

**Permission:** Only `TEACHER`+ for viewing versions. `SYS_ADMIN` for restore.

---

### 4.4 Export Student/Faculty Data

| Layer | Files | Changes |
|-------|-------|---------|
| `B` | New route: `GET /api/v1/flashcards/stats/export?period=30d` | Returns CSV with columns: `student_name, deck, cards_studied, accuracy, avg_ef, trend` |
| `F` | `src/components/flashcards/stats-client.tsx` | Export button in stats dashboard header |

---

## Dependency Graph

```
Phase 1 ✅
├── 1.1 Batch API ✅ ───► 2.1 Batch Selection UI ✅
├── 1.2 DeckDetailScreen Split ✅ (independent)
└── 1.3 getDueCards RPC ✅ ───► 4.1 Per-Student Stats (also uses get_teacher_stats)

Phase 2 — 1/5 complete ✅
├── 2.1 Batch Selection UI ✅ (needs 1.1)
├── 2.2 Keyboard Shortcuts (independent)
├── 2.3 Session Summary (needs new table)
├── 2.4 Search (independent)
└── 2.5 Streaks (needs new tables, independent)

Phase 3 — not started
├── 3.1 Media (needs migration + storage)
├── 3.2 Cloze (needs migration)
├── 3.3 CSV Import/Export (independent)
└── 3.4 APKG Import/Export (independent, but similar UI to 3.3)

Phase 4 — not started
├── 4.1 Per-Student Insights (needs 1.3 foundation)
├── 4.2 Period Comparison (needs stats service)
├── 4.3 Card Versioning (needs migration + trigger)
└── 4.4 Data Export (independent)
```

All phases are independent at the PR level — you can start Phase 3 items before finishing Phase 1.
