# StudiQ Product Roadmap

> Target: Nov/Dec 2026 | Pre-market startup — no backward compat layers
>
> Last verified against `main`: 2026-10-27.

## Scope

StudiQ is delivered as a course project. **The scope is this roadmap and nothing beyond it.** Ideas that are not in a phase below (2FA, user self-service account deletion, invoices, due-date reminders, offline mode, …) are deliberately out of scope until there are signs the project becomes a real product. Gamification (streaks, XP, badges, leaderboards) was removed from the plan on 2026-10-16 and is not coming back.

## Legend

| Icon | Meaning |
|------|---------|
| ✅ | Done |
| 🏗️ | Partly done |
| 📋 | Planned (has an issue) |
| 💤 | Future / deferred — not part of the current scope |

## Status at a glance

| Phase | Topic | Status |
|-------|-------|--------|
| 0 | Foundation | ✅ |
| 1 | Org hierarchy — groups | ✅ |
| 2 | Resource sharing & visibility | ✅ |
| 3 | Teacher tools | 🏗️ quiz builder + assignments done; question-bank polish, documents, dashboard open |
| 4 | AI integration | 🏗️ agent + security done; 4B extensions open |
| 5 | Student experience | 🏗️ stats and SRS basics done; dashboard, goals, extra stats open |
| 6 | Subscription gating | 🏗️ gating + seats done; real Stripe open |
| 7 | Admin dashboard & analytics | 🏗️ admin panel done; global stats open |
| 8 | Polish & launch | 🏗️ branding, onboarding checklists, SEO done; notifications, shortcuts, empty states open |

Terminology: the roadmap was written when organizations were called universities. The code now uses **organizations** (`organizations`, `org_members`, `org_roles`), **groups** and **plans / features / limits**; the old `university_*` names no longer exist.

---

## Phase 0: Foundation ✅

| Item | Status | Notes |
|------|--------|-------|
| Next.js 16 App Router + Bun monorepo | ✅ | `apps/web` (:3000), `apps/admin` (:4000), `packages/server`, `packages/authz`, `packages/ui` |
| 4-layer pattern (Route → Controller → Model → Service) | ✅ | Enforced via `AGENTS.md`; `ControllerResponse`, `withAuth`, `AppError` mapping |
| Auth: e-mail / password (Supabase) | ✅ | Register, login, password reset / update, soft-deleted accounts with a 30-day grace period (admin) |
| Invitations | ✅ | Token links with role selection, preview and accept, copyable link; e-mail delivery is tracked in [#604](https://github.com/logyQT/studiq/issues/604) |
| Account types | ✅ | `STUDENT`, `EDUCATOR`, `MANAGER` plus org roles with per-role permissions |
| RBAC | ✅ | `org_roles`, `org_role_permissions`, scopes `own / group / organization / any`, `can()` on the client |
| RLS | ✅ | Enabled on every public table |
| i18n | ✅ | `next-intl`, `pl` + `en`, namespace per component |
| Flashcards, decks, topics, practice (SM-2), study sessions, search | ✅ | Plus CSV import / export, media upload, cram mode, suspend / restore |
| Questions, question banks, quizzes, attempts, review | ✅ | MCQ, true/false, open |
| Observability | ✅ | OpenTelemetry → Collector → Tempo / Prometheus / Loki, Grafana dashboards, `error_logs` |

---

## Phase 1: Org Hierarchy — Study Groups ✅

| Item | Status | Notes |
|------|--------|-------|
| `groups`, `group_members` | ✅ | `/api/v1/organization/groups/*`, `/api/v1/me/groups` |
| Group-scoped permissions | ✅ | `group` scope in `org_role_permissions`, group-aware list filters |
| Group management UI | ✅ | `/edu/groups`, `/manage/groups` |
| Classrooms | ✅ | `/edu/classroom/*` onboarding for teachers |

## Phase 2: Resource Sharing & Visibility ✅

Implemented with a `visibility` column (`personal | group`) plus junction tables instead of a single `group_id`, so one resource can be shared with several groups.

| Item | Status | Notes |
|------|--------|-------|
| Visibility on decks, topics, question banks | ✅ | `deck_groups`, `topic_groups`, `bank_groups` |
| Share to groups in create / edit forms | ✅ | Group multi-select |
| Copy a resource | ✅ | `POST /api/v1/flashcards/[id]/copy` |
| Read-only view of shared banks for non-authors | ✅ | #152 |
| `resource_permissions` per-user grants | 💤 | Table exists, unused; group sharing covers the use case |

---

## Phase 3: Teacher Tools 🏗️

### Subphase 3A: Quiz Builder & Assignments ✅

| Item | Status | Notes |
|------|--------|-------|
| Quiz builder | ✅ | `/edu/quizzes`, drag-to-add, reorder, points; `/api/v1/teacher/quizzes/*` |
| Assignments (kartkówka / sprawdzian) | ✅ | Publish to groups, time limit, student take page, manual grading, results per student and per question, print view, answer export |
| Quiz route restructure | ✅ | Superseded: sessions live under `/app/study/session/quiz/[attemptId]` |

### Subphase 3B: Question Bank Polish 🏗️

| Item | Status | Notes |
|------|--------|-------|
| Bulk actions | ✅ | `/api/v1/questions/banks/batch/[action]` |
| Tags | ✅ | Topics play this role (`question_topic_assignments`); no separate tag table by decision |
| Server-side pagination + search | 📋 | [#651](https://github.com/logyQT/studiq/issues/651) |
| CSV / JSON import and export | 📋 | [#652](https://github.com/logyQT/studiq/issues/652) |

### Subphase 3C: Documents 📋

| Item | Status | Notes |
|------|--------|-------|
| Documents library (upload, list, share) | 📋 | [#653](https://github.com/logyQT/studiq/issues/653); the `documents` feature flag is already seeded |

### Subphase 3D: Teacher Dashboard 📋

| Item | Status | Notes |
|------|--------|-------|
| Activity feed, student performance, problem-question alerts | 📋 | [#654](https://github.com/logyQT/studiq/issues/654); `recharts` is already a dependency |
| Teacher statistics pages | ✅ | `/edu/statistics`, `/edu/stats/*`, `/edu/flashcards/stats` |

---

## Phase 4: AI Integration 🏗️

> Architecture and current state: [`docs/ai.md`](ai.md). Security: [`docs/plans/agent-security.md`](plans/agent-security.md).

### Subphase 4A: Basic / MVP ✅

| Item | Status | Details |
|------|--------|---------|
| Agent Q (ReAct multi-agent) | ✅ | Streaming chat at `/app/ai` and `/edu/ai`; tools: plan, ask user, fetch material, extract concepts, generate flashcards, evaluate quality, webfetch, finish |
| Flashcard generation from text / PDF | ✅ | Via agent tool calling |
| Usage tracking | ✅ | Daily token limit enforced (`max_ai_tokens_per_day`), usage badge in the chat |

### Subphase 4B: Extended 📋

| Item | Status | Issue |
|------|--------|-------|
| QuestionAgent — question / quiz generation | 📋 | [#658](https://github.com/logyQT/studiq/issues/658) |
| NotesAgent + Tutor mode | 📋 | [#659](https://github.com/logyQT/studiq/issues/659) |
| Modular commands `/summary`, `/quiz`, `/explain` | 📋 | [#660](https://github.com/logyQT/studiq/issues/660) |
| YouTube / image / audio input | 📋 | [#661](https://github.com/logyQT/studiq/issues/661) |

### Subphase 4C: Advanced 💤

LearningPathAgent, ReportAgent, multi-agent pipelines and adaptive difficulty are deferred.

### Security hardening

| Item | Status |
|------|--------|
| Account type enforcement on the agent route | ✅ |
| URL guard for `webfetch` (SSRF) | ✅ |
| Token budget enforcement | ✅ |
| `RequestContext` in agent execution | ✅ |
| Rate limiting | ✅ In-memory, per process |
| `AgentScope` type for provable narrow scope | 💤 |

---

## Phase 5: Student Experience 🏗️

### Subphase 5A: Dashboard 📋

| Item | Status | Notes |
|------|--------|-------|
| Stat cards and quick actions on `/app` | ✅ | |
| Continue where you left off, due-cards summary, upcoming assignments, recent activity | 📋 | [#655](https://github.com/logyQT/studiq/issues/655) |

### Subphase 5B: SRS Enhancements 🏗️

| Item | Status | Notes |
|------|--------|-------|
| Leech detection | ✅ | |
| Fuzz factor | ✅ | |
| Load balancing + daily study goal | 📋 | [#656](https://github.com/logyQT/studiq/issues/656) |

### Subphase 5C: Stats 🏗️

| Item | Status | Notes |
|------|--------|-------|
| Overview, daily activity chart, state breakdown, weak points, quiz stats | ✅ | `/app/stats/*` |
| Study time, subject mastery, retention curve | 📋 | [#657](https://github.com/logyQT/studiq/issues/657) |

---

## Phase 6: Subscription Gating 🏗️

| Item | Status | Notes |
|------|--------|-------|
| Feature flags | ✅ | DB-backed `features`, `feature_flags`, per-plan and per-role (`org_role_features`), user overrides, admin UI |
| Plans, limits and gating | ✅ | `subscription_plans`, `plan_features`, `plan_limits`, `/pricing`, upgrade prompts, plan limits resolved live |
| Seat-based licensing | ✅ | `org_seat_pools`, assignments, `/manage/seats` ([plan](plans/seat-based-licensing.md)) |
| Checkout, billing pages, payment history | ✅ | Simulated by `mock-stripe.service.ts` |
| Real Stripe | 📋 | [#662](https://github.com/logyQT/studiq/issues/662); live verification needs Stripe test keys |

---

## Phase 7: Admin Dashboard & Analytics 🏗️

| Item | Status | Notes |
|------|--------|-------|
| Admin app (`apps/admin`) | ✅ | Organizations, plans, feature flags, user overrides, users with role change, soft delete, restore and purge |
| 7A Global stats + daily activity | 📋 | [#663](https://github.com/logyQT/studiq/issues/663) |
| 7B User management | ✅ | Covered by the users page |
| 7C Request logs and performance | ✅ | Superseded by the Grafana / Prometheus / Loki / Tempo stack; no `request_logs` table |

---

## Phase 8: Polish & Launch 🏗️

| Item | Status | Notes |
|------|--------|-------|
| 8A Org branding | ✅ | Logo upload, brand colour, gated by the `branding` feature |
| 8B Onboarding | 🏗️ | Setup wizard and role checklists done; empty states + first-visit hints [#666](https://github.com/logyQT/studiq/issues/666) |
| 8C SEO & meta | ✅ | Root metadata, Open Graph image, manifest, sitemap, robots, per-page titles |
| 8D UX polish | 🏗️ | Loading skeletons, invitation preview + role confirmation done; notification center [#664](https://github.com/logyQT/studiq/issues/664), keyboard shortcuts [#665](https://github.com/logyQT/studiq/issues/665) |

---

## Deferred / not in scope

| Item | Why |
|------|-----|
| Extra question types (multi-select, matching, ordering, fill-in-blank) | Spec drafted in [`plans/tbd/QUESTION_TYPES_SPEC.md`](plans/tbd/QUESTION_TYPES_SPEC.md), not approved; the database enum already allows them |
| Flashcard → question conversion | Same spec |
| Alternative dashboard layout | Proposal only: [`plans/tbd/AlternativeDashboardUI.md`](plans/tbd/AlternativeDashboardUI.md) |
| Phase 4C AI features, `AgentScope` | Future |
| Gamification | Removed from scope on 2026-10-16 |

## Key Technical Decisions

- **No backward compat layers** — pre-market, schema changes are made in place.
- **Groups share by junction table** — a resource can be visible to several groups; `resource_permissions` stays unused.
- **SM-2 is done** — only the 5B enhancements remain.
- **LLM provider abstracted** — OpenAI-compatible and Ollama.
- **Feature flags, plans and limits are DB-backed** — plan changes need no deploy.
- **External providers sit behind interfaces chosen by config** — payments are a mock today and become a Stripe driver in [#662](https://github.com/logyQT/studiq/issues/662); mail follows the same pattern in [#604](https://github.com/logyQT/studiq/issues/604).
- **No hyphens in routes** — all API and frontend routes use `/` segments only.
