# Foundation & Agentic Testing — Execution Plan (Tracking)

Status: ACTIVE
Last updated: 2026-09-14

## Decisions (locked)

- Monorepo 2 apps: `packages/authz` + `packages/ui` + `apps/web` + `apps/admin`
- Admin auth: app-level signed header (Ed25519 PEM keypair, verified in admin proxy)
- Tests: API-first `before()` seeding everywhere
- Feature-flag keys: flat keys everywhere (drop `FEATURE_FLAG_TO_FEATURE_KEY`)
- No backward-compat layers (pre-market, delete old paths cleanly)

## Order

- Phase A first (independent, immediate value)
- Phase B before Phase C (de-tangle before moving code into packages)
- Phase D last (runs on the stable foundation)

---

## Phase A — Reusable API-first `before()` (test foundation)

Status: COMPLETE (helper built + all API-flow suites migrated; DB drift repaired; 186/186 green)

### Verification baseline (2026-09-14, updated)
- `bun run lint` — clean (tsc + biome 629 files + import-path guard)
- `bun test:unit` — 580/580 green
- `bun test:integration` — **186/186 green** (all 19 files). Schema drift repaired:
  - `questions.bank_id` NOT NULL → helpers create implicit bank via `seedQuestion()`
  - `flashcards.deck_id` NOT NULL → helpers create implicit deck via `seedFlashcard()`
  - `question_answers` → `question_options` rename (migration `20260716000001`) propagated
    via PostgREST aliases into all server services; API response keys preserved (`question_answers`)
  - `quiz_answers` → `student_answers`, `selected_answer_id` → `selected_option_id` propagated
  - `flashcards.deck_id` FK changed from `ON DELETE SET NULL` → `ON DELETE CASCADE`
    (migration `20260710000001` corrected + new `20260717000002` corrective migration)
  - `handle_new_organization` trigger restored seat-pool seeding (`20260714000003` updated)
  - `bulk_create_flashcards` schema file updated to match migration `20260711000002`
  - Plan config (`launch.max_groups`=3, `base` limits=-1) lives in `seeds/00_plans.sql`
    (no standalone migration — plan system is seed-managed)
  - Test bodies updated: `bankId` in questions POST, `deckId` in flashcard bulk create,
    `question_options` in rpc-questions assertions

### Onboarding blockers fixed (2026-09-14)
- 422 bulk invite (`targetOrgRoleId: 'member'` hardcoded name) — `createAndJoin` now returns
  `teacherRoleId`/`memberRoleId`/`defaultGroupId`; onboarding sends `memberRoleId`.
- 429 invite accept for fresh `base`-plan students — new `PlanResolver.checkOrgLimit()`
  resolves capacity from the invitation's org instead of the student's personal plan;
  accept now uses it; seed fallback removed. Regressions: `invite-accept.test.ts`,
  `organization-create.test.ts` (response shape), `members.test.ts` (real accept path).
- Details: `docs/plans/api-gaps.md`.

### Goals
- `__tests__/helpers/test-user.ts`: `before(profile)` — idempotent account creation + API-driven seeding
- Confirm-email bridge (service-role `auth.admin.updateUserById`)
- Migrate suites off direct service-role seeding
- Track API gaps (`api-gaps.md`) for routes that don't exist yet

### Tasks
- [x] `createTestUser({ role, email? })` — lookup → register API → confirm → `mockUser()`
- [x] `seedViaApi({ org, groups, members, questions, decks, flashcards, topics, quizzes, assignment })`
- [x] `before(profile)` orchestrator returning `{ user, orgId, groups, createdByIds }`
- [x] API-gap bridge (banks, `subjects`, direct member-add) + `api-gaps.md`
- [x] Migrate `members.test.ts` as proof (10/10 green) — defects surfaced: invite accept 429, group limit 1
- [x] Migrate remaining integration suites (bulk) to `before()` — all 11 API-flow suites migrated:
      `members`, `flashcard-topics`, `flashcard-decks`, `flashcards`, `flashcard-practice`,
      `quizzes`, `quiz-attempts`, `stats`, `questions`, `invitations`, `organization-create`, `seats`
- [x] Verify: `bun test:unit` (580) + `bun test:integration` (186) green + `bun run lint` clean

### DB-subject suites retained as-is (documented keep-as-is)

These suites exercise DB-level subjects (triggers/RPCs), role types outside the
`before()`/`createTestUser` role set (student|educator|manager), or the auth flows
themselves — they are not API-flow suites and intentionally stay on service-role seeding:

| Suite | Reason retained |
|-------|-----------------|
| `university` | SYS_ADMIN flows + role-id matrix (`org_roles`) exercised via service-role lookups; SYS_ADMIN not in the `before()` role set |
| `org-features` | DB trigger test (`handle_new_organization` default roles) — org inserted directly to assert trigger output |
| `rpc-questions` | RPC subject (`list_questions` pgSQL with `p_*` params + explicit created_by/user_id) — DB-level, not route-level |
| `auth` | Tests register/login/session flows themselves — the `before()` helper depends on these routes |
| `health` | Public ping endpoint, no auth/org — no migration needed |

`TEST_USERS`/`seedOrganization`/`seedQuestion` remain referenced ONLY by the suites
above (plus their definitions in `helpers.ts`); the API-first suites run without them.

### Handoff: test parallelism (next task)

Phase A done → next agent should pick up `docs/plans/test-parallelism.md` (full prompt):
enable file parallelism + in-file concurrency + a 3×-side-by-side self-stress (every test
runs as 3 concurrent copies) to prove isolation and catch flakes in one pass.

---

## Phase B — Decouple flags / perms / limits

Status: NOT STARTED

### Tasks
- [x] B1 Flat canonical keys everywhere; delete `FEATURE_FLAG_TO_FEATURE_KEY`
- [x] B2 `FeatureResolver`: user override → org_role override → plan entitlement → rollout% → global flag
- [x] B3 Make `rollout_percentage` live (deterministic user_id bucketing + `X-Feature-Rollout` header)
- [x] B4 Enforce `feature_permissions` (flag ⟹ required perms) **or** drop table — dropped (`20260915000001`); dead docs-only junction, zero read sites
- [x] B5 Split limits out of `PlanResolver` → `LimitsResolver` — PlanResolver (limits-only since B2) renamed to `limits.resolver.ts` / `LimitsResolver`
- [x] B6 Client: `useFeature()` + `usePermission()`; delete `useCan`
- [x] B7 Split `/api/v1/permissions/me` → `/permissions/me` (permissions only) + `/features/me` (features + rollout; `X-Feature-Rollout` header)
- [x] B8 Unify `@/lib/access.ts` + `@/lib/rbac.ts` → one `@/lib/authz`; delete `rbac.ts` — N+1 fixed: `buildQueryFilter`/`checkPermission`/`hasPermission` now resolve from with-auth's batched `ctx.permissionScopes` (zero per-permission DB queries); access.ts group queries stay async
- [x] B9 Admin Rollout Control — surfaces verified complete + hardened: global toggle + rollout % (`/admin/feature-flags`), plan matrix (`/admin/subscription-plans`), user overrides (`/admin/user-overrides`), per-flag kill switch ("Stop now" = `is_enabled=false`); added canonical-key enforcement (admin create/update models now reject non-`FEATURES` keys → no silent dead rows)
- [x] B10 Fix broken admin: removed `/admin/permissions` (matrix read dropped `role_permissions`; canonical source is `DEFAULT_ROLE_PERMISSIONS`), deleted dead `/admin/logs` + `error_logs` table (zero writers; OTEL spans are the error surface), dropped `/admin/ai` dead link; sidebar + i18n cleaned
- [ ] Verify: unit tests for FeatureResolver precedence + rollout, RBAC union tests, lint, full suite green

---

## Phase C — Detach admin panel (monorepo)

Status: NOT STARTED

### Tasks
- [ ] C1 Bun workspace scaffold; create `packages/authz`, `packages/ui`
- [ ] C2 Move pure logic/constants/authz → `packages/authz`; UI primitives + shared layout → `packages/ui`
- [ ] C3 `apps/web`: remove admin; block `/admin*` + `/api/v1/admin*` in proxy
- [ ] C4 `apps/admin`: standalone Next app; own build/domain; service-role server-side session
- [ ] C5 PEM gate in `apps/admin/proxy.ts` (Ed25519, header signature, rotation list)
- [ ] C6 Split i18n `Admin*` namespaces into `apps/admin`
- [ ] C7 Two standalone builds; edge routing for `/admin*`
- [ ] C8 Hardening: introduce RLS on user content tables (biggest security gap today)
- [ ] Verify: PEM-gated admin smoke, main-app 404/403 on `/admin*`, all tests in both apps

---

## Phase D — Agentic testing on the foundation

Status: NOT STARTED

### Tasks
- [ ] D1 Manifest `tests/features/manifest.yaml` (roles, routes, flags, plan, before(profile))
- [ ] D2 Generator → deterministic matrix + smoke specs (LLM-free)
- [ ] D3 Agent loop (existing `LLM_*` endpoint + AI SDK tools): fill interactive specs, run, triage
- [ ] D4 Rollout tests first-class ("disable `quiz` → student loses access; re-enable → restored")
- [ ] D5 Classification: bug / vision-drift / flaky; fixes on a branch for review

---

## Definitions of Done (global)
- `bun run lint` clean in all packages
- All unit + integration tests green
- No orphan tables/dead code left (per AGENTS.md ethos)