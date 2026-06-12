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

**✅ SECURITY TODO:**
- ✅ Hide decks the user does not own in bulk operation deck pickers (Link, Move, Copy dialogs) — `ownedDecks` filter via `can(role, 'deck.update', d.created_by, userId)` in `deck-detail-dialogs.tsx` (5 pickers: Link, Copy, BulkLink, BulkMove, BulkCopy)
- ✅ Mutation options (topic assignments, move, delete) for flashcards are already gated by `canUpdate`/`canDelete` props computed via `can()` in `deck-detail-screen.tsx`

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
| | `/` | Focus search | ⏳

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

### 2.4 Global Search Infrastructure ✅

**Scope expansion:** What started as flashcard-only search evolved into a global search infrastructure — a unified `/api/v1/search` endpoint with a top-bar search bar in `DashboardLayout`, designed to extend to other domains (questions, notes, etc.).

| Layer | Files | Changes |
|-------|-------|---------|
| `M` | New: `20260615000000_search_vector.sql` | Add `search_vector tsvector` generated column (GIN indexed) to `flashcards`. Combines English + Polish via `\|\|` operator for bilingual search. |
| `M` | New: `20260615000001_search_flashcards_rpc.sql` | `search_flashcards(search_query, result_limit)` — PL/pgSQL function querying with both `plainto_tsquery('english', q)` OR `plainto_tsquery('polish', q)`, ranked by sum of `ts_rank`. Returns `(id, front, back, rank, deck_id, deck_name)`. |
| `B` | New model: `src/server/models/search.model.ts` | `SearchQuerySchema` (Zod, registered for OpenAPI), `SearchResult` type with `type: 'flashcard'` discriminator for union expansion. |
| `B` | New service: `src/server/services/search.service.ts` | `SearchService.search(q, ctx, limit?)` — calls `supabase.rpc('search_flashcards', ...)`, maps DB rows to `SearchResult[]`. Extensible: add more `.rpc()` calls for other domains. |
| `B` | New controller: `src/server/controllers/search.controller.ts` | `SearchController.search(body, ctx)` — standard validate+delegate pattern. |
| `B` | New route: `GET /api/v1/search?q=&limit=` | With `withAuth` wrapper. Already protected by catch-all API route rule. |
| `F` | New: `src/hooks/use-debounce.ts` | Custom `useDebounce<T>(value, delay)` hook (~15 lines). Avoids adding a package. |
| `F` | New: `src/components/layout/app-search.tsx` | Debounced (300ms) search input + Command dropdown, 2-char minimum, `Ctrl+K`/`/` shortcut, keyboard nav, loading/no-results states. Uses `cmdk` (already in deps). |
| `F` | `src/components/layout/DashboardLayout.tsx` | Insert `<AppSearch />` centered between title and toggles in the top bar. |
| `F` | `src/lib/query-keys.ts` | Add `searchKeys` for future cache invalidation. |
| `I` | `src/i18n/messages/en.json` + `pl.json` | Add `search_placeholder`, `search_no_results`, `search_shortcut` to `DashboardLayout` namespace. |

**Architecture decisions:**

| Decision | Rationale |
|----------|-----------|
| **Separate `SearchService`** (not on `FlashcardService`) | Domain-agnostic service. Adding `searchQuestions()`, `searchNotes()` later means adding methods here, not scattering search logic across domain services. |
| **PostgreSQL RPC** instead of Supabase JS `.textSearch()` | Supabase JS doesn't support OR-ing two language configs in a single query. The RPC queries both `plainto_tsquery('english', ...)` and `plainto_tsquery('polish', ...)` with proper ranking. |
| **Combined `\|\|` tsvector** (not two columns) | Single generated column, single GIN index. Both language lexemes coexist. Concatenation preserves position info for ranking. |
| **`search_vector` as generated STORED** | No trigger needed. Updated automatically on INSERT/UPDATE. Backfilled for existing rows with a one-time UPDATE. |
| **`useDebounce` custom hook** (not `use-debounce` package) | ~15 lines, one dependency. Avoids adding a package for such a trivial utility. |
| **`cmdk` Command component** (already in deps) | The shadcn `Command` component is already installed at `cmdk: 1.1.1`. No new dependencies for the dropdown. |
| **Results link to deck detail** | Click navigates to `/app/flashcards/decks/{deckId}?highlight={flashcardId}`. The highlight param enables future scroll-to-card behavior. |
| **Top-bar placement, not per-page** | YouTube/Facebook pattern: always-visible search in the DashboardLayout header. Available on every authenticated page. |
| **Bilingual from day one** | Combined `'english' + 'polish'` tsvector with fallback creation of Polish config via `DO $$` block if absent. |

**Known limitations:**
- Currently only searches `flashcards` table. Questions, notes, decks, topics are not yet indexed.
- Polish tsconfig creation assumes `pg_catalog.simple` is available (always true in PostgreSQL).
- `highlight` search param in deck detail URLs is not yet consumed — the deck detail page doesn't auto-scroll to the highlighted card.
- RPC function uses `LEFT JOIN` on deck assignments — a flashcard with zero deck assignments returns `href: '#'`.

---

### 2.5 Study Streaks & Daily Goals — Deferred

Streaks are a habit-retention mechanic (Duolingo, Snapchat). StudiQ is a study tool, not a habit app. The infrastructure cost (2 new tables, service, controller, route, widget) doesn't justify the marginal motivation gain. Revisit if user engagement data suggests otherwise.

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

**Infrastructure needed:**
- `supabase/config.toml`: define `flashcard-media` bucket with 50MiB limit, allowed MIME types (`image/*`, `audio/*`)
- Migration: `INSERT INTO storage.buckets` + RLS policies for `storage.objects`
- New: `src/server/services/storage.service.ts` — singleton, wraps `supabase.storage.from('flashcard-media')`
- Install `katex` for LaTeX rendering on frontend
- **Decision needed:** Client-side upload (browser → Supabase via anon key + RLS) vs server-side (browser → API → Supabase via service role)

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

**Infrastructure needed:**
- Session rendering integration: `SessionClient` renders front/back inline (not via `FlashcardCard`)
  - Option A (simpler): conditionally render `<ClozeCard>` vs inline `<p>` in `SessionClient`
  - Option B (cleaner): extract card rendering into shared component, use everywhere — larger refactor
- **Recommendation:** Option A for now

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

**Infrastructure needed:**
- Install `papaparse` (server + browser compatible CSV parser)
- Reuses existing `flashcardService.bulkCreate()` for import
- Export builds CSV manually (no library needed for simple serialization)

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

**Infrastructure needed:**
- Install `jszip` for APKG archive read/write
- Uses `bun:sqlite` (built-in) to read Anki's `collection.anki2` — no `better-sqlite3` required
- **Depends on 3.1 media storage** for extracted APKG media files
- Shares `import-dialog.tsx` UI with 3.3 CSV (add as second tab)

---

## Recommended Build Order

| Order | Feature | Why |
|-------|---------|-----|
| 1st | **3.3 CSV Import/Export** | No migration, no external deps (just `papaparse`), immediate user value, quickest win |
| 2nd | **3.2 Cloze Deletion** | Self-contained — needs one migration (`type` column) + UI only, no storage or packages |
| 3rd | **3.1 Media in Cards** | Foundational — sets up Supabase Storage bucket/service that 3.4 also needs. Installs `katex`. |
| 4th | **3.4 APKG Import/Export** | Hardest — needs `jszip` + SQLite parsing + media handling from 3.1 storage |

### Infrastructure Inventory

| Item | 3.1 Media | 3.2 Cloze | 3.3 CSV | 3.4 APKG |
|------|-----------|-----------|---------|----------|
| **Migration** | `ADD COLUMN media jsonb` | `ADD COLUMN type text` | None | None |
| **New package** | `katex` | None | `papaparse` | `jszip` (Bun built-in `bun:sqlite` for APKG SQLite) |
| **Storage bucket** | `flashcard-media` (new) | None | None | Uses 3.1's bucket for extracted media |
| **Storage RLS** | SELECT/INSERT/DELETE policies | None | None | None |
| **New service** | `storage.service.ts` | None | `flashcard-import.service.ts` | `flashcard-apkg-{import,export}.service.ts` |
| **New component** | `media-upload.tsx` | `cloze-card.tsx`, `cloze-editor.tsx` | `import-dialog.tsx`, `export-button.tsx` | Tab in import-dialog |
| **Key decision** | Client-side vs server-side upload | Session rendering: Option A (inline conditional) vs B (shared component) | — | — |

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

Phase 2 — 4/5 complete ✅
├── 2.1 Batch Selection UI ✅ (needs 1.1)
├── 2.2 Keyboard Shortcuts (independent)
├── 2.3 Session Summary (needs new table)
├── 2.4 Search (independent)
└── 2.5 Streaks (deferred — not worth the infra)

Phase 3 — build order: 3.3 → 3.2 → 3.1 → 3.4
├── 3.3 CSV Import/Export (independent, no deps, quickest win) — done
├── 3.2 Cloze Deletion (needs migration, independent) — done
├── 3.1 Media in Cards (needs migration + storage bucket + katex) ───► 3.4 needs storage
└── 3.4 APKG Import/Export (needs jszip + bun:sqlite + 3.1 storage for media) — done

Phase 4 — not started
├── 4.1 Per-Student Insights (needs 1.3 foundation)
├── 4.2 Period Comparison (needs stats service)
├── 4.3 Card Versioning (needs migration + trigger)
└── 4.4 Data Export (independent)
```

All phases are independent at the PR level — you can start Phase 3 items before finishing Phase 1.
