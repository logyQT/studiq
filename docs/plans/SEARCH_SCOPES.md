# Search Scopes

Per-role search vision for the StudiQ global search bar.

| Role | Domain | Route | Current | Phase 1 | Phase 2 | Phase 3 |
|------|--------|-------|---------|---------|---------|---------|
| STUDENT / FREE / PREMIUM | Student | `/app` | Flashcards | Topics | Notes, questions | AI-powered discovery |
| TEACHER | Education | `/edu` | Flashcards | Topics, class decks | Shared resources, student submissions | Cross-course analytics |
| UNIVERSITY_ADMIN | Management | `/manage` | — (hidden) | Members, invitations | University-wide content | Audit logs |
| SYS_ADMIN | Admin | `/admin` | — (hidden) | Organizations, sys admins | Pending invites, error logs | Permissions, settings |

---

## Current (flashcard full-text search)

All authenticated users on `/app` or `/edu` routes. Backed by `GET /api/v1/search?q=&limit=10` which proxies to the `search_flashcards` RPC. Results grouped by flashcard with per-deck navigation. Ownership-scoped via `buildQueryFilter(ctx, Permission.FLASHCARD_READ)` — users only see flashcards they created or that belong to their university.

- **API**: `GET /api/v1/search?q=&limit=10`
- **RPC**: `public.search_flashcards(search_query, result_limit, p_user_id, p_university_id)`
- **Frontend**: `src/components/layout/app-search.tsx` → `src/components/search/flashcard-search-result.tsx`

## Phase 1

### Topics — `/app` and `/edu`

Index `flashcard_topics` with a `search_vector` column (bilingual en+pl). Add topics to the search results as a second result type. Same ownership scoping rules as flashcards.

Implementation sketch:
- New migration: `ALTER TABLE flashcard_topics ADD COLUMN search_vector tsvector GENERATED ...`
- New RPC: `search_topics(search_query, limit, p_user_id, p_university_id)` or extend the unified search endpoint to accept a `types` filter param
- New component: `src/components/search/topic-search-result.tsx`

### Class decks — `/edu` only

Teacher-specific: search their own decks by name/description. Lightweight — just a `WHERE name ILIKE` or `to_tsvector('english', name || ' ' || COALESCE(description, ''))`.

## Phase 2

### Notes — `/app`

Full-text search across user notes (`title`, `body`). Own-scoped only.

### Questions — `/app`

Full-text search across user questions (`content`). Own-scoped only.

### Shared resources — `/edu`

Search all flashcards/decks shared to the teacher's classes.

### Members — `/manage`

Search university members by `name`, `email`, `role`. Backed by `profiles` table filtered by `university_id`. Returns a user card with quick-actions (edit role, resend invite, remove).

### University-wide content — `/manage`

Search all flashcards, decks, and topics within the university. Same as the `/edu` and `/app` search but across all teachers/students in the university.

## Phase 3

### Everything else (`/admin`, `/manage` audit, AI discovery)

- **Organizations**: search `universities` table by name, domain, status
- **Sys admins**: search `profiles` with `role = SYS_ADMIN`
- **Pending invites**: search `invitations` by email, status, role
- **Error logs**: search `error_logs` by message, code, user, time range
- **Permissions**: search `permissions` / `role_permissions` by name, role, scope
- **AI-powered discovery**: semantic search across all content types

---

## Implementation pattern (extending to new types)

1. **Model** (`src/server/models/search.model.ts`): Add a new union member to `SearchResult` — e.g. `{ type: 'topic', id, title, subtitle, href, rank }`
2. **Service** (`src/server/services/search.service.ts`): Add a new private method — e.g. `searchTopics(q, ctx, limit)` — call it from the public `search` method, merge results
3. **Controller / Route**: No changes needed — the search endpoint returns `SearchResult[]` regardless of type
4. **Component** (`src/components/search/*.tsx`): Create a new result component — e.g. `TopicSearchResult`
5. **AppSearch** (`src/components/layout/app-search.tsx`): Add a new `case` in the `switch (result.type)` dispatch

The flat-index keyboard navigation handles new types automatically — each type reports its `itemCount` via the `itemOffsets` memo, and the `data-search-index` attribute ensures scroll-into-view works regardless of type.
