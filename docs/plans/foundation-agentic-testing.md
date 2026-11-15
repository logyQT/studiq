# Foundation & Agentic Testing — Execution Plan (Tracking)

> **AI architecture reference:** [`docs/ai.md`](../ai.md) — unified doc covering architecture, tools, security, and extension guide.

Status: ACTIVE
Last updated: 2026-11-12

> **Historical admin-auth note:** the PEM gate described in this plan was
> removed. `apps/admin` is internal, has no app-level auth, and is not deployed;
> see [ADR-0009](../decisions/0009-admin-is-internal-not-deployed.md). The rest
> of the plan is unchanged history.

## Decisions (locked)

- Monorepo 3 apps: `packages/authz` + `packages/ui` + `packages/server` + `apps/web` + `apps/admin`
- Admin auth: none today — `apps/admin` is internal and **not deployed**; the PEM
  gate was removed. If it is ever deployed, the app-level gate
  ([ADR-0009](../decisions/0009-admin-is-internal-not-deployed.md), blocker 2)
  must land first; edge protection (blocker 5) remains mandatory at deployment.
- Tests: API-first `before()` seeding everywhere
- Feature-flag keys: flat keys everywhere (drop `FEATURE_FLAG_TO_FEATURE_KEY`)
- No backward-compat layers (pre-market, delete old paths cleanly)
- Seat licensing: opt-in per-user upgrades only — NO default/seed pools at org
  creation; everyone gets org-plan defaults (`org_role_features`, with capacity
  derived live from `organizations.plan → plan_limits` since #229 removed the
  `org_limits` snapshot); a seat is bought/assigned per user and upgrades only
  that user (e.g. extra AI quota for one teacher). Seats can never grant
  admin-only features (`org.manage`/`member.manage`/`role.builder`) to a
  non-admin role.
- Admin panel is a standalone app (`apps/admin`), not sub-routes of the main app;
  dev on `:4000` (no clash with main app's `:3000`), production on its own
  subdomain (e.g. `internal.studiq`). Main app contains zero admin routes when
  Phase C completes.
- **RLS deferred** — app-layer auth (`buildQueryFilter`/`checkPermission`) is the
  sole authorization mechanism. RLS is a last-stage concern; the multi-tenancy
  complexity (orgs, groups, visibility, role hierarchy) makes DB-level policies
  high-cost/low-value until the app is near-shipped. Revisit post-launch if
  direct API bypass becomes a real threat vector.
- **Admin data access** — admin app queries Supabase directly via service-role
  client; admin-specific controllers/services live in `apps/admin/src/server/`.
  Shared services (orgs, subscription plans) stay in `packages/server/` and are
  imported by both apps.

## Order

- Phase A first (independent, immediate value) ✅
- Phase B before Phase C (de-tangle before moving code into packages) ✅
- Phase B.5 (seat cleanup) before Phase C — C2 extracts the post-cleanup FeatureResolver ✅
- Phase C: monorepo scaffold + admin detach — C1-C16 complete, C8 deferred ✅
- Phase E: main app moved to `apps/web/` ✅
- Phase D: agentic testing — **split and deferred**: mechanical cases become the deterministic
  Playwright suite in [`archive/e2e-campaign.md`](archive/e2e-campaign.md); judgement-heavy cases stay
  agentic (see [PR #77](https://github.com/logyQT/studiq/pull/77))

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

| Suite           | Reason retained                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| `org-features`  | DB trigger test (`handle_new_organization` default roles) — org inserted directly to assert trigger output       |
| `rpc-questions` | RPC subject (`list_questions` pgSQL with `p_*` params + explicit created_by/user_id) — DB-level, not route-level |
| `auth`          | Tests register/login/session flows themselves — the `before()` helper depends on these routes                    |
| `health`        | Public ping endpoint, no auth/org — no migration needed                                                          |

`TEST_USERS`/`seedOrganization`/`seedQuestion` remain referenced ONLY by the suites
above (plus their definitions in `helpers.ts`); the API-first suites run without them.

---

## Phase B — Decouple flags / perms / limits

Status: COMPLETE

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
- [x] Verify: lint clean (`tsc` + biome + import-path guard), unit **961/961**, integration **558/558** green (single run; `seats` 1-test failure = documented 3× copy stress flake, 30/30 in isolation); authz union/scope tests in `__tests__/unit/lib/authz.test.ts`, FeatureResolver precedence + rollout covered in service unit tests

---

## Phase B.5 — Seat licensing cleanup (opt-in per-user upgrades)

Status: COMPLETE — landed before Phase C; checkout quantity wiring deferred to #662 / #1019.

Why: seats are the per-headcount add-on ("green-light one teacher's AI quota,
not an org-wide upgrade for everyone"). The pre-B.5 implementation was inert
bookkeeping that conflicted with that intent: pools were pre-seeded at org
creation from `plan_seat_allocations`, nothing could grow a pool, assignment
wasn't role-aware, and `FeatureResolver` swapped a seat plan in wholesale —
letting a campus seat grant `org.manage`/`member.manage`/`role.builder` to a
member. Cleaning the axis before C2 moved `FeatureResolver` into
`packages/authz` removed that leak.

### Tasks (scope of the seats PR)

- [x] S1 Drop default pool seeding — remove seat-pool creation from
      `handle_new_organization` (`20260708000002` + `20260714000003`) and the
      `plan_seat_allocations` seed in `seeds/00_plans.sql`; drop the
      `plan_seat_allocations` table (clean drop migration)
- [x] S2 Pools are on-demand only — `seat.service` creates a pool when a seat
      is added/purchased (addPool), never at org creation; `listPools` shows
      only realized purchases
- [x] S3 Fix `FeatureResolver` precedence: seat plan = additive upgrade over
      the org-role base, then re-apply role restrictions per key so a
      non-admin role can never inherit org.manage/member.manage/role.builder
      through a seat (privilege leak)
- [x] S4 Role-aware assignment — `seat.service` validates pool plan vs target
      account_type/org role (teacher→educator tier, student→student tier);
      the seats UI suggests the compatible seat per member instead of a
      free-for-all branded-pool menu
- [x] S5 Seats API + `manage/seats` page: pools = purchased quantities
      (add-to-pool on buy; checkout wiring comes later — after the monorepo
      PRs, mechanics first)
- [x] S6 Migrate tests to new semantics: `seats.test.ts` (integration),
      `seat.service.test.ts` / `seat.controller.test.ts` (unit),
      `feature.resolver.test.ts` seat-precedence cases; drop coverage of
      default/seeded pools
- [x] Verify: lint clean + unit + integration green; seats PR merged before
      Phase C starts

### Open (deferred with billing)

- Org-plan pricing shape (flat vs per-headcount) — interacts with seat
  add-ons; decide together with the checkout work later.

---

## Phase C — Detach admin panel (monorepo)

> **Prerequisite (met):** legacy AI dead code was removed before C — see `docs/ai.md` → "Dead code to remove"; B.5 landed before C2.

Status: C1-C16 COMPLETE, C8 DEFERRED (see decisions)

### Tasks — scaffold & detach (COMPLETE)

- [x] C1 Bun workspace scaffold; create `packages/authz`, `packages/ui`
- [x] C2 Move pure logic/constants/authz → `packages/authz` (FeatureResolver already post-B.5 — seat-as-upgrade, no default pools); UI primitives + shared layout → `packages/ui`
- [x] C3 `apps/web`: remove the admin Next.js route segment (`src/app/(frontend)/admin/`) and any admin API routes in `(backend)` — zero `/admin*` routes remain in the main app
- [x] C4 `apps/admin`: standalone Next app; own build; dev on `:4000` (no clash with main app `:3000`), production on its own subdomain (e.g. `internal.studiq`); service-role server-side session
- [x] C5 PEM gate in `apps/admin/proxy.ts` (Ed25519, header signature, rotation list)
- [x] C6 Split i18n `Admin*` namespaces into `apps/admin` — PR [#78](https://github.com/logyQT/studiq/pull/78)
- [x] C7 Two standalone builds; main app has no admin routes (admin app served entirely on its own origin)
- [ ] C8 ~~Hardening: introduce RLS on user content tables~~ — **DEFERRED** (see decisions). App-layer auth is sufficient for now; RLS complexity (orgs/groups/visibility/roles) is high-cost/low-value pre-launch.

### Tasks — server extraction & move (COMPLETE)

- [x] C9 Create `packages/server/` with shared services, models, lib utilities — PR [#80](https://github.com/logyQT/studiq/pull/80)
- [x] C10 Update main app imports: `@/server/*` → `@studiq/server/*`, `@/lib/*` (moved) → `@studiq/server/lib/*` — PR [#80](https://github.com/logyQT/studiq/pull/80)
- [x] C11 Move admin-only services/controllers from packages/server to `apps/admin/src/server/` — PR [#80](https://github.com/logyQT/studiq/pull/80)
- [x] C12 Clean up dead code in main app — PR [#80](https://github.com/logyQT/studiq/pull/80)
- [x] C13 Move `src/` → `apps/web/src/`, update workspace config, update root scripts — PR [#80](https://github.com/logyQT/studiq/pull/80)
- [x] C14 Verify: `bun run build` (main), `bun run build:admin` (admin), both dev servers independent — PR [#80](https://github.com/logyQT/studiq/pull/80)

### Tasks — rebuild admin API & UI (COMPLETE)

Admin pages deleted in C3 were rebuilt in `apps/admin/`. Server-side
controllers and services live in `apps/admin/src/server/`; the API route
handlers and frontend pages below are in place.

**Architecture:**

- Admin app queries Supabase **directly** via service-role client (no cross-origin calls)
- Admin-specific controllers/services live in `apps/admin/src/server/`
- Shared services live in `packages/server/`
- Admin frontend calls its own `/api/` routes (same origin)

#### C15 — Admin API routes (COMPLETE)

`apps/admin/src/app/(backend)/api/v1/` route handlers:

1. Accept requests (no app-level auth — internal-only app, not deployed; see ADR-0009)
2. Parse input with Zod (reuse existing models)
3. Call the corresponding controller
4. Return JSON via `toNextResponse()`

Route handlers:

| Route                             | Controller                        | Methods                         |
| --------------------------------- | --------------------------------- | ------------------------------- |
| `/api/v1/feature-flags`           | `featureFlagController`           | GET (list), POST (create)       |
| `/api/v1/feature-flags/[key]`     | `featureFlagController`           | GET (one), PUT (update), DELETE |
| `/api/v1/plan-features`           | `planFeatureController`           | GET, POST                       |
| `/api/v1/plan-features/[id]`      | `planFeatureController`           | GET, DELETE                     |
| `/api/v1/plan-limits`             | `planLimitController`             | GET, POST                       |
| `/api/v1/plan-limits/[id]`        | `planLimitController`             | GET, PUT, DELETE                |
| `/api/v1/user-overrides`          | `userOverrideController`          | GET, POST                       |
| `/api/v1/user-overrides/[id]`     | `userOverrideController`          | GET, PUT, DELETE                |
| `/api/v1/subscription-plans`      | `subscriptionPlanAdminController` | GET, POST                       |
| `/api/v1/subscription-plans/[id]` | `subscriptionPlanAdminController` | GET, PUT, DELETE                |

**Auth for admin API routes**: No `withAuth` wrapper — `apps/admin` is
internal, has no app-level auth and is not deployed (ADR-0009).
Controllers run with full service-role permissions. Do not expose the app
until the ADR-0009 blockers clear; if fine-grained tokens are added later
(see "Side note" below), add a lightweight scope check middleware.

#### C16 — Admin frontend pages (COMPLETE)

`apps/admin/src/app/(frontend)/` pages use `@studiq/ui` components +
`next-intl` translations:

| Page               | Route                 | Source (old)                                    | Notes                                                     |
| ------------------ | --------------------- | ----------------------------------------------- | --------------------------------------------------------- |
| Orgs list          | `/orgs`               | `admin/orgs/page.tsx` (299 lines)               | List all orgs: avatar, name, plan, members, groups, roles |
| Org detail         | `/orgs/[id]`          | `admin/orgs/[id]/page.tsx` (283 lines)          | Overview + members/groups/roles tables                    |
| Feature flags      | `/feature-flags`      | `admin/feature-flags/page.tsx` (314 lines)      | CRUD: key, name, description, enabled, rollout%           |
| Subscription plans | `/subscription-plans` | `admin/subscription-plans/page.tsx` (596 lines) | Plans + feature assignments + limits                      |
| User overrides     | `/user-overrides`     | `admin/user-overrides/page.tsx` (308 lines)     | Per-user feature overrides                                |

Old page content viewable via: `git show 5fdae54^:src/app/\(frontend\)/admin/<path>`

Pages should use `useApiQuery`/`useApiMutation` from the shared pattern
(or admin-local equivalents calling `/api/v1/*` on same origin).

### Side note — GitHub-style fine-grained admin tokens

If admin is ever deployed, a single shared gate would be too blunt. Use
GitHub-style fine-grained tokens so an operator can grant **partial**
access — e.g. "read orgs, write feature flags, nothing else" — without
handing over the keys to the whole system:

- **Token = keyed scopes, least privilege by construction**: every admin API
  request authenticates with a bearer token carrying an explicit scope list
  (`orgs:read`, `features:write`, `plans:read`, `overrides:write`, …). No token
  ever implies "everything"; the intersection of scopes and the DB policy is
  what a request can actually do. Gap = deny.
- **Read vs write split**: each surface gets at least `:read` and `:write`
  (write implies read). Tokens can be read-only everywhere, or mixed — the
  checkboxes enforce it, so there's no way to mint an "all-scopes" token by
  accident (and even if you did, that's an explicit, auditable choice).
- **Scope set mirrors the admin surfaces 1:1** — orgs, feature-flags (rollout /
  kill-switch), subscription plans + plan matrix, user overrides, plan limits —
  so the generation UI's checkbox list maps directly to what the API can touch.
- **Generation UI in `apps/admin`** ("Settings → Tokens → Generate new"):
  name + expiry + scope checkboxes → plaintext secret shown **once** (GitHub
  style). DB stores **only the SHA-256 hash** + `last_used_at`; an expired or
  revoked token 401s regardless of scope. List/revoke screen stays trivial since
  we never store plaintext.
- **Implementation anchor**: the token middleware resolves the scope list into
  `RequestContext.permissionScopes`, reusing the same batched map that B8's
  `@/lib/authz` already consumes — so controllers keep calling
  `hasPermission`/`checkPermission`/`buildQueryFilter` **unchanged**. Until
  token scopes land, admin stays internal-only with no app-level auth.

---

## Phase D — Agentic testing on the foundation

Status: **DEFERRED** — see [PR #77](https://github.com/logyQT/studiq/pull/77) for
the agentic testing infrastructure work. Phase D will pick up from that PR's
foundation now that the admin rebuild and server extraction (C9-C16) are
complete. The testing framework depends on a stable monorepo structure, so it
runs after the structural refactors are done.

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
- Admin app: all 5 pages functional, dev server on `:4000`; internal only — no
  app-level auth (the PEM gate was removed on 2026-11-06), and deployment is
  blocked until the ADR-0009 blockers clear
- `packages/server/` extracted, both apps import from it
- Main app moved to `apps/web/`, zero cross-app imports
