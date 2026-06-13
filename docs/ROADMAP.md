# StudiQ Product Roadmap

> Target: Nov/Dec 2026 | Pre-market startup — no backward compat layers

## Legend

| Icon | Meaning |
|------|---------|
| ✅ | Done |
| 🏗️ | In progress |
| 📋 | Planned |
| 💤 | Future / deferred |

---

## Phase 0: Foundation (Current State ✅)

> Everything already built — architecture, auth, RBAC, i18n, error handling, core modules.

### Architecture

| Item | Status | Notes |
|------|--------|-------|
| Next.js 16 App Router + Bun | ✅ | All routes follow `route.ts` pattern |
| 4-layer pattern (Route → Controller → Model → Service) | ✅ | Strictly enforced via AGENTS.md |
| `ControllerResponse` union + `toNextResponse` | ✅ | All API responses wrapped |
| `withAuth` + `withErrorHandling` wrappers | ✅ | Auth at route layer, error handling at controller layer |
| `AppError` codes → HTTP status mapping | ✅ | `APP_ERRORS` map in `src/lib/errors.ts` |

### Auth & Users

| Item | Status | Notes |
|------|--------|-------|
| Email/password auth (Supabase) | ✅ | No SSO/OAuth |
| Invitation flow with role selection | ✅ | `/manage/invitations`, token-based, 7-day expiry |
| Registration with/without invite | ✅ | Invite → sets `target_role` + `university_id`; self-reg → `free` role |
| 6 user roles | ✅ | `FREE`, `PREMIUM`, `STUDENT`, `TEACHER`, `UNIVERSITY_ADMIN`, `SYS_ADMIN` |
| Role-change RPC (`admin_change_role`) | ✅ | Security definer, checks caller permissions |

### RBAC

| Item | Status | Notes |
|------|--------|-------|
| DB: `permissions`, `role_permissions` tables | ✅ | 9 permissions, 3 scopes (`own`, `university`, `any`) |
| DB: `resource_permissions` table | ✅ | **Empty / unused** — designed for future per-resource grants |
| Backend: `checkPermission()`, `buildQueryFilter()`, `hasPermission()` | ✅ | In-memory cached from DB |
| Backend: `shouldSetUniversityId()` | ✅ | Used by resource services on create |
| Frontend: `can()` | ✅ | Static map, covers `deck.*` and `flashcard.*` only |
| Permission seed data | ✅ | All 6 roles × 9 permissions × scope |

### i18n

| Item | Status | Notes |
|------|--------|-------|
| `next-intl` with `en` + `pl` | ✅ | `NEXT_LOCALE` cookie, ICU message format |
| Namespace-per-component pattern | ✅ | `Common` namespace auto-merged via `mergeCommon()` |
| Translation key convention | ✅ | Snake_case, matching `APP_ERRORS` constants |

### Core Modules

| Item | Status | Notes |
|------|--------|-------|
| Flashcards CRUD | ✅ | With topic assignments, deck assignments |
| Flashcard decks CRUD | ✅ | Personal collections |
| Flashcard topics CRUD | ✅ | University-scoped tags |
| Flashcard practice + SM-2 spaced repetition | ✅ | Fully implemented, tested |
| Flashcard study sessions | ✅ | Session logging, summary |
| Due cards retrieval RPC | ✅ | `get_due_flashcards` with RBAC, topic/deck filtering |
| Flashcards search | ✅ | Full-text search |
| Questions CRUD | ✅ | MCQ, True/False, Open types |
| Quiz generation (random) | ✅ | Auto-select from question bank by filters |
| Quiz attempts + review | ✅ | Full quiz-taking + review UI |
| Subjects CRUD | ✅ | University-scoped |
| Student stats endpoint | ✅ | Quizzes, scores, flashcards, accuracy |
| Teacher stats endpoint | ✅ | Question/flashcard counts |
| Teacher flashcard stats (detailed) | ✅ | By-deck, by-topic, difficulty breakdown |

### Infra

| Item | Status | Notes |
|------|--------|-------|
| Supabase setup (3 clients) | ✅ | browser, server, service-role |
| Error logging to `error_logs` table | ✅ | `INTERNAL_SERVER` errors only |
| Admin error log viewer | ✅ | `/admin/logs` with search |
| Admin permissions matrix viewer | ✅ | `/admin/permissions` |
| Admin university creation + invite sending | ✅ | `/admin` page |
| Route protection middleware (`proxy.ts`) | ✅ | Role-based redirects for UI, JSON 401/403 for API |
| RLS | ⚠️ | Enabled on 3/22 tables only — deferred |

### Known Route Conflict (pre-Phase 3 fix)

The dynamic route `[attemptId]` under `/quiz/` conflicts with static segments like `builder`. Must restructure before Phase 3:

| Current | New |
|---------|-----|
| `GET POST /api/v1/quiz/[attemptId]` | `GET POST /api/v1/quiz/attempt/[id]` |
| `/app/quiz/[attemptId]` | `/app/quiz/session/[id]` |
| `/app/quiz/review/[attemptId]` | `/app/quiz/session/review/[id]` |

This is a **pre-Phase 3 prerequisite** — can be done standalone.

### Current Gaps

| Gap | Impact | Phase |
|-----|--------|-------|
| No groups | Only org-wide or individual scoping | 1 |
| `resource_permissions` table unused | No explicit sharing | 2 |
| Question service manual scoping | Inconsistent with rest | 1 |
| Quiz service manual scoping | Inconsistent with rest | 1 |
| No feature flags | Can't toggle features per role | 6 |
| No analytics | No usage data for decisions | 7 |
| No onboarding | Empty dashboards for new users | 8 |
| Boilerplate SEO | No OG images, generic meta | 8 |
| Settings page placeholder | Can't edit name/branding | 8 |

---

## Phase 1: Org Hierarchy — Study Groups 📋

> Sub-units within a university. Group-scoped RBAC. Teachers create groups, add students, share resources to a single group.

**Priority**: HIGH — everything downstream depends on this.

### DB Changes (3 new files)

- `supabase/schemas/56_study_groups.sql` — `study_groups(id, university_id FK, name, description, created_by FK, created_at, updated_at)`
- `supabase/schemas/57_group_members.sql` — `group_members(id, group_id FK, user_id FK, role IN ('member','manager'), UNIQUE per pair)`
- Migration: `ALTER TABLE questions ADD COLUMN group_id uuid REFERENCES study_groups(id) ON DELETE SET NULL` (same for `flashcards`, `flashcard_decks`, `flashcard_topics`) + indexes
- Migration: Update `role_permissions` CHECK to include `'group'`

### Seed Data

- STUDENT: `flashcard.read`, `topic.read`, `deck.read` → scope `group` (was `university`)
- TEACHER: same permissions → scope `group` (was `own`)

### Backend RBAC (`src/lib/rbac.ts`)

- Add `'group'` to `PermissionScope` type
- Add `group_id?: string | null` to `Resource` interface
- `checkPermission` group case: query `group_members` for membership check
- `buildQueryFilter` group case: query user's group IDs, return `or: created_by.eq.X,group_id.in.(...)`

### Frontend RBAC (`src/lib/frontend-rbac.ts`)

- Add `'group'` to `Scope` type
- Extend `can()` with `resourceGroupId?` + `userGroupIds?: string[]`
- Group scope: `createdBy === userId || userGroupIds.includes(resourceGroupId)`

### Group API (4-layer pattern, 7 route files)

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/v1/groups` | List (teacher → own/managed, admin → all) |
| `POST` | `/api/v1/groups` | Create (TEACHER, UNIV_ADMIN) |
| `GET` | `/api/v1/groups/[id]` | Detail |
| `PUT` | `/api/v1/groups/[id]` | Update (creator, manager, or admin) |
| `DELETE` | `/api/v1/groups/[id]` | Delete (cascades members, SET NULLs resources) |
| `GET` | `/api/v1/groups/[id]/members` | List members |
| `POST` | `/api/v1/groups/[id]/members` | Add member (manager or admin) |
| `DELETE` | `/api/v1/groups/[id]/members/[userId]` | Remove member (manager or admin) |

Files: `group.model.ts`, `group.service.ts`, `group.controller.ts`, 4 route files.

### Resource Service Updates

- Add `groupId: z.string().uuid().optional()` to create/update schemas for questions, flashcards, decks, topics
- Set `group_id: data.groupId ?? null` on insert in resource services
- Refactor `question.service.ts` `list()`/`getById()` → use `buildQueryFilter`
- Refactor `quiz.service.ts` `generateQuiz()` → use `buildQueryFilter`
- Flashcard/deck/topic services already use `buildQueryFilter` → auto-benefit

### Frontend — Group Management

| Route | Component | Description |
|-------|-----------|-------------|
| `/edu/groups` | `TeacherGroupListPage` | Teacher's groups, create/edit/delete |
| `/edu/groups/[id]` | `TeacherGroupDetailPage` | Member management |
| `/manage/groups` | `AdminGroupListPage` | All university groups |
| `/manage/groups/[id]` | `AdminGroupDetailPage` | Admin member management |

Sidebar nav items added to both layouts.

### Frontend — Share UI

- `GroupShareSelect` component — dropdown of user's managed groups
- Optional "Share to group" toggle in resource create/edit forms
- Share icon on resource detail pages → change-group dialog

### i18n

`Groups` namespace: `create_group`, `edit_group`, `delete_group`, `group_name`, `group_description`, `members`, `add_member`, `remove_member`, `share_to_group`, `no_groups`, `confirm_delete_group_delete`, `member_role_manager`, `member_role_member`

**~20 new files, ~15 modified. Blocks Phase 2 and Phase 3.**

---

## Phase 2: Resource Sharing & Visibility 📋

> Populate `resource_permissions` table. Add `visibility` column to resources. Multi-group via copy workflow.

**Priority**: HIGH — core differentiator for university use case.

### DB Changes

- Add `visibility` column (`private`, `university`, `public`) to `questions`, `flashcards`, `flashcard_decks`, `flashcard_topics`
- Add `group_id` column to `resource_permissions`
- Expand `resource_permissions.resource_type` CHECK to include `question`, `flashcard`

### Backend

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/v1/resources/[type]/[id]/permissions` | List who has access |
| `POST` | `/api/v1/resources/[type]/[id]/permissions` | Grant access (user or group) |
| `DELETE` | `/api/v1/resources/[type]/[id]/permissions/[permId]` | Revoke access |
| `POST` | `/api/v1/resources/[type]/[id]/copy` | Copy resource to another group |

New service: `resourcePermissionService` — grant, revoke, list. `buildQueryFilter` extended to handle visibility scopes.

### Frontend

- Visibility selector in resource create/edit (radio: Private / University / Public)
- Share dialog on resource detail (tabs: Users + Groups → search and grant)
- "Copy to group" context menu on resource cards
- Visibility badges on resource cards

**~8 new files, ~10 modified. Blocks Phase 3.**

---

## Phase 3: Teacher Tools 📋

> Quiz builder, question bank management, documents, teacher dashboard. Requires quiz route restructure from Phase 0 prerequisite.

**Priority**: HIGH — unlocks teacher role value prop.

### Phase 3 Prerequisite: Quiz Route Restructure

Before adding `builder` under `/quiz/`, move session routes to avoid `[attemptId]` conflict:

**API:**
| Current | New |
|---------|-----|
| `GET POST /api/v1/quiz/[attemptId]` | `GET POST /api/v1/quiz/attempt/[id]` |
| Stays | `/api/v1/quiz/attempts` |
| Stays | `/api/v1/quiz/new` |

**Frontend:**
| Current | New |
|---------|-----|
| `/app/quiz/[attemptId]` | `/app/quiz/session/[id]` |
| `/app/quiz/review/[attemptId]` | `/app/quiz/session/review/[id]` |
| Stays | `/app/quiz` |

All existing links, redirects, and API client calls must be updated.

### Subphase 3A: Quiz Builder

Re-create `quizzes` + `quiz_questions` tables (dropped in `51_quiz_refactor`):

```sql
CREATE TABLE public.quizzes (
  id uuid PK,
  university_id FK,
  created_by FK,
  title text NOT NULL,
  description text,
  subject_id FK,
  visibility text,
  created_at timestamptz
);

CREATE TABLE public.quiz_questions (
  id uuid PK,
  quiz_id FK,
  question_id FK,
  order_index int,
  points int DEFAULT 1
);
```

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/v1/quiz/builder` | List saved quizzes |
| `POST` | `/api/v1/quiz/builder` | Create quiz with question IDs |
| `GET` | `/api/v1/quiz/builder/[id]` | Get quiz detail with questions |
| `PUT` | `/api/v1/quiz/builder/[id]` | Update quiz metadata |
| `DELETE` | `/api/v1/quiz/builder/[id]` | Delete quiz |
| `POST` | `/api/v1/quiz/builder/[id]/questions` | Add/reorder questions |

Frontend:
- `/edu/quiz/builder` — visual builder: browse question bank, drag-to-add, reorder, set points
- `/edu/quiz/builder/[id]` — edit existing
- `/edu/quiz/builder/[id]/preview` — preview as student
- Quiz distribution to groups (uses Phase 2 sharing)
- Student takes teacher quiz via `/app/quiz/session/[id]` (attempt references `quiz_id`)

### Subphase 3B: Question Bank Polish

- Server-side pagination + full-text search on question list endpoint
- `question_tags` junction table + tag CRUD
- Bulk actions: select multiple → batch delete, batch move to subject/group
- CSV/JSON import and export
- `/edu/questions` enhancements: paginated table, search bar, tag filter, bulk checkboxes

### Subphase 3C: Documents

- `documents` table: `id, university_id, created_by, title, description, file_url, file_type, visibility, group_id, created_at`
- Supabase Storage bucket `documents` with RLS
- `POST /api/v1/documents/upload` — file upload → storage → DB record
- `GET /api/v1/documents` — list (scoped)
- `GET PUT DELETE /api/v1/documents/[id]` — CRUD
- `/edu/documents` — document library with upload, list, search
- `/edu/documents/[id]` — document detail with download
- Document sharing via Phase 2

### Subphase 3D: Teacher Dashboard

- `/edu` page enhancements: recent activity feed, student performance overview, problematic question alerts, class stats
- Chart library integration (recharts / visx / nivo) for subject breakdowns
- Student performance: avg scores, quiz completions, flashcard accuracy per group

### i18n

New namespaces: `QuizBuilder`, `Documents`, `TeacherDashboard` — ~60-80 keys.

**~30 new files, ~20 modified.**

---

## Phase 4: AI Integration 🏗️

> Implement the 3-phase AI roadmap from `docs/AI-integration.md`. Parallel track — mostly independent of org hierarchy.

**Priority**: HIGH — core product differentiator.

### Subphase 4A: Basic/MVP

| Item | Status | Details |
|------|--------|---------|
| Flashcard generation from PDF | ✅ | SSE-streamed, OpenAI/Ollama |
| AI question generation | 📋 | `POST /api/v1/ai/questions` — generate MCQ/TF/Open from text |
| AI quiz generation | 📋 | `POST /api/v1/ai/quiz` — generate full quiz from subject + topic |
| Provider interface extension | 📋 | Add `generateQuestions()`, `generateQuiz()` to `LLMProvider` |
| `/edu/questions` AI generate button | 📋 | Teachers input text → AI creates questions |

### Subphase 4B: V2 — Voice & Chat

| Item | Details |
|------|---------|
| AI oral exam | Web Speech STT → AI asks questions verbally → student responds → AI evaluates |
| AI tutor chatbot | Chat interface, RAG over university content |
| Explain wrong answers | Post-quiz AI explanation |
| AI summarization | Long text → bullet points, key concepts |

### Subphase 4C: V3 — Personalization

| Item | Details |
|------|---------|
| Personalized learning paths | Recommendations from weak areas |
| Adaptive difficulty | Quiz questions adjust based on past performance |
| AI grading of open questions | LLM evaluates free-text answers |

### Gating

All AI features behind PREMIUM tier (Phase 6). Usage limits per user per day (configurable per plan).

**~15 new files, ~10 modified. Independent of Phases 1-3.**

---

## Phase 5: Student Experience 📋

> Personalize the student-facing app. Engagement features, visual progress tracking.

**Priority**: MEDIUM — improves retention.

### Subphase 5A: Dashboard Redesign

- `/app` from static nav hub to personalized feed
- "Continue where you left off" — in-progress quizzes, recent flashcards
- Due cards summary with progress bar
- Upcoming teacher-assigned quizzes
- Recent activity timeline (last 5-10 actions)

### Subphase 5B: SRS Enhancements

- Leeches detection (cards consistently failed → flag for teacher)
- Load balancing (spread due cards across days)
- Fuzz factor (small offset to prevent card clumping)
- Daily study goal setting + progress tracking

### Subphase 5C: Gamification

- Streak tracking (consecutive days with practice)
- XP/points system
- Achievement badges (milestones: first quiz, 10-day streak, 1000 cards)
- Optional per-group leaderboard
- New tables: `achievements`, `user_daily_activity`

### Subphase 5D: Stats Enhancement

- Charts + trends over time + subject breakdown on `/app/statistics`
- Performance trends (line chart: quiz scores over time)
- Subject mastery (per-subject quiz + flashcard accuracy)
- Weakest topics (bottom-N by accuracy)
- Study time tracking (total, daily average, busiest days)
- Flashcard retention curve

**~20 new files, ~15 modified.**

---

## Phase 6: Subscription Gating 📋

> Wire up subscription tables to enforce feature access. Required before public launch.

**Priority**: HIGH — required before launch.

### Feature Flag System

- `feature_flags` DB table: `id, key, name, description, roles_required text[]`
- `featureFlagService` — load from DB, cache, `canUserAccess(key)`
- API middleware for gated routes
- Frontend `useFeatureFlag(key)` hook — conditionally render UI

### Gating Matrix (proposed)

| Feature | Free | Premium | Student | Teacher | Univ Admin | Sys Admin |
|---------|------|---------|---------|---------|------------|-----------|
| Basic flashcards | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Basic quizzes | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Groups | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| AI flashcards | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| AI quiz gen | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| AI oral exam | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Quiz builder | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Documents | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Advanced stats | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |

### University Plan Gating

- `basic` (50 seats, no docs) / `pro` (500 seats, docs + groups) / `enterprise` (unlimited)
- Seat limit enforcement on invite
- Plan change request from `/manage/settings`

### Stripe Integration

- `POST /api/v1/subscriptions/checkout` — create checkout session
- `POST /api/v1/subscriptions/webhook` — sync status, upgrade role
- `POST /api/v1/subscriptions/cancel` — downgrade at period end

### Frontend

- `/pricing` — plan comparison table
- `/manage/settings` — live subscription info
- Upgrade prompts (banner/toast on gated features)
- Plan badge in navbar/sidebar

**~12 new files, ~25 modified.**

---

## Phase 7: Admin Dashboard & Analytics 📋

> Sys admin visibility into platform usage, user management across orgs, system health.

**Priority**: LOW — operational tooling.

### Subphase 7A: Global Stats

- `GET /api/v1/admin/stats` — total users, universities, active users, storage, content counts
- `GET /api/v1/admin/stats/daily` — daily registrations, quiz attempts, practice sessions (30/90 day)
- `/admin` dashboard redesign with stat cards + charts

### Subphase 7B: User Management

- `GET /api/v1/admin/users` — all users across orgs with search, pagination, role filter
- `GET PUT /api/v1/admin/users/[id]` — detail, change role, suspend
- `/admin/users` pages with table + detail view

### Subphase 7C: Traffic & Performance

- Request logging middleware → `request_logs` table
- `GET /api/v1/admin/request/logs` — searchable, filterable
- `/admin/request/logs` page with sort by duration, error rate display
- Performance alerts for slow endpoints

**~10 new files, ~8 modified.**

---

## Phase 8: Polish & Launch 📋

> Production readiness: branding, onboarding, SEO, UX polish.

**Priority**: MEDIUM.

### Subphase 8A: Org Branding

- Add `logo_url`, `brand_color`, `brand_accent` to `universities` table
- `PUT /api/v1/university/branding` — update brand settings
- `/manage/settings` — editable name, slug, logo, colors
- Logo upload → Supabase Storage
- Dynamic theme from brand color

### Subphase 8B: Onboarding

- Welcome wizard per role (step-by-step)
- Role-specific tours
- Empty state components on all list pages
- First-visit tooltip hints

### Subphase 8C: SEO & Meta

- Real StudiQ metadata in root layout
- Open Graph tags (og:title, og:description, og:image)
- Twitter card tags
- Per-page dynamic meta
- `robots.ts` — allow public pages, disallow app/admin/manage/edu

### Subphase 8D: UX Polish

- Loading skeletons (replace spinners)
- Page transitions
- Keyboard shortcuts (`?` → shortcuts modal)
- In-app notification system
- Invitation flow: preview destination, confirm role on accept

**~8 new files, ~20 modified.**

---

## Dependencies Graph

```
Phase 0
  ├── Phase 1 (Groups) ──► Phase 2 (Sharing)
  │                           └──► Phase 3 (Teacher Tools)
  │                                        └──► Phase 6 (Gating)
  ├── Phase 4 (AI) ──────────────────────────► Phase 6 (Gating)
  ├── Phase 5 (Student UX) ──────────────────► Phase 6 (Gating)
  ├── Phase 7 (Admin) (independent)
  └── Phase 8 (Polish) (depends on all)
```

## Parallel Work Tracks

| Track A: Org & Sharing | Track B: AI | Track C: Student UX |
|------------------------|-------------|---------------------|
| Phase 1 (Groups) | Phase 4A (Basic AI) | Phase 5A (Dashboard) |
| Phase 2 (Sharing) | Phase 4B (Voice) | Phase 5B (SRS) |
| Phase 3 (Teacher Tools) | Phase 4C (Personalized) | Phase 5C (Gamification) |

Tracks A and B can run fully in parallel. Track C starts after Phase 1.

## File Inventory

| Phase | New Files | Modified Files |
|-------|-----------|----------------|
| 0 (existing) | ~150 | — |
| 1 (Groups) | ~20 | ~15 |
| 2 (Sharing) | ~8 | ~10 |
| 3 (Teacher Tools) | ~30 | ~20 |
| 4 (AI) | ~15 | ~10 |
| 5 (Student UX) | ~20 | ~15 |
| 6 (Gating) | ~12 | ~25 |
| 7 (Admin) | ~10 | ~8 |
| 8 (Polish) | ~8 | ~20 |

## Key Technical Decisions

- **No backward compat layers** — old `quizzes`/`quiz_questions` dropped in Phase 0, cleanly re-added in Phase 3
- **Single group per resource** — `group_id` column. Multi-group via copy, not junction tables
- **`resource_permissions` evolves** — empty in Phase 0, populated in Phase 2 with user+group grants
- **SM-2 is done** — no rework, optional enhancements in Phase 5
- **LLM provider abstracted** — interface + openai + ollama providers, easy to extend
- **Feature flags are DB-backed** — not hardcoded, plans can update without deploys
- **No hyphens in routes** — all API and frontend routes use `/` segments only
