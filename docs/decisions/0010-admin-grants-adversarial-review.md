# ADR-0010: Enforcement limits of org-scoped support grants — adversarial review

## Status

Proposed — **review record, not an accepted decision**. It constrains ADR-0007 (`docs/decisions/0007-admin-api-auth.md`) and the two forthcoming ADRs for the grant model and the audit log. Nothing here is implemented.

Scope of the review: the claim that a support engineer or an **agent** can be given a _narrow, time-boxed_ view of one organization, running **the same queries a member would**, with `org_id` bound by the grant and no god mode. I looked for where that claim is falsifiable in today's code.

---

## Context

### 0. What the panel must do (from `qa/cases/ADM-*.md`)

The panel is already org-aware in its _output_ but not in its _authorization_: `ADM-ORG-01`/`ADM-ORG-02` require a list of **all four** organizations and, for one org, its members (name, e-mail, role), groups and role/permission matrix; `ADM-USR-01/02` require a **platform-wide** user list with e-mail search and account creation; `ADM-USR-05/06` require ban/unban and an irreversible hard delete; `ADM-SEC-02` states plainly that the **UI itself is unauthenticated** — only `/api/*` is gated.

That is a panel whose _read_ surface is deliberately cross-tenant. The grant model has to carve a per-org slice out of a surface that was built global. Everything below is about whether that slice can be enforced where it counts.

### 1. P0 — The org bound is **optional data**, so it cannot be "bound by the grant"

This is the finding that decides the design. Tenancy in this codebase is not a predicate that must be supplied; it is a key that _may_ be present in a filter object.

`packages/server/src/lib/authz.ts:105-119` (`buildQueryFilter`) and `:289-313` (`accessibleFilter`) return **`{}`** for the `any` scope — no org key at all. Callers then apply it conditionally:

```ts
// packages/server/src/services/flashcard.service.ts:144-146
if (filter.or) query = query.or(filter.or);
if (filter.created_by) query = query.eq('created_by', filter.created_by);
if (filter.organization_id) query = query.eq('organization_id', filter.organization_id);
```

Omit the key and you have a whole-table read. Today RLS is the only thing standing between `{}` and "every tenant" — and **RLS is exactly what a service-role client removes**. The admin app only has a service-role client (`apps/admin/src/lib/supabase/admin-client.ts:9-11`; `apps/admin/src/lib/supabase/service.ts:3-13`). A grant session built the obvious way (service role + `if (grant.orgId) filter`) is therefore not narrow; it is narrow _when the developer remembers_.

Three concrete, already-live instances of the filter going wide:

- **`resolveFilterType` maps `organization` scope to `any`.** `packages/server/src/services/flashcard-practice.service.ts:862-873` checks only `_useRpc` and `created_by`; an org-scoped caller's filter is `{ organization_id }`, which matches neither, so it falls through to `{ filterType: 'any', organizationId: null }` (`:872`). That is passed to `get_due_flashcards` (`:395-404`), and the RPC's `CASE` has `WHEN 'any' THEN TRUE` (`supabase/schemas/99_rpc_functions.sql:36-41`). RLS currently hides this; service role would not.
- **`search_flashcards` treats both tenancy params as optional.** `supabase/schemas/99_rpc_functions.sql:365-366`: `AND (p_organization_id IS NULL OR ...) AND (p_user_id IS NULL OR ...)`. `packages/server/src/services/search.service.ts:28-44` sets them only for `own`/`group`; for `organization` scope both stay `null` → full-text search over every organization's cards.
- **The breakdown RPCs have the same shape.** `99_rpc_functions.sql:164-179` and `:195-209`: `p_created_by IS NULL AND p_organization_id IS NULL` means _no filter_, not _no rows_.

**Consequence for the ADR:** "org_id bound by the grant" must be a **required argument of the query builder**, not a filter key. `buildQueryFilter` returning `{}` for `any` is the god-mode switch the operator wants to abolish, and it is one string away from every service in `packages/server/src/services`. A grant-bound session must never be able to reach `any`.

### 2. P0 — The admin panel has **no actor** below the proxy

`apps/admin/src/proxy.ts:169-171` carefully deletes and re-sets `x-admin-key-id`. **Nothing reads it.** A repo-wide search finds the header only in `proxy.ts` and its definition in `admin-pem.ts:16`. Every controller signature is actor-free (`apps/admin/src/server/controllers/user-admin.controller.ts:19-95`, `organization-admin.controller.ts:14-45`), and every mutation is a bare write with no `updated_by`:

```ts
// apps/admin/src/server/services/feature-flag.service.ts:63-68
.from('feature_flags').update(updateData).eq('id', id).select().single()
```

Same for `plan-limit.service.ts:50`, `plan-feature.service.ts:35`, `user-override.service.ts:40-78`, `user-admin.service.ts:344,373`.

So the attribution chain ends in a log line — and ADR-0007 already records that the admin app has **no `instrumentation.ts`**, so those records land on `console` (`docs/decisions/0007-admin-api-auth.md:74-75`; there is still no `apps/admin/src/instrumentation.ts`). A `users:purge` hard delete today leaves: no DB row, no durable log, no `x-trace-id` consumer (the admin app never calls `withRequestInstrumentation`, so `packages/server/src/lib/request-instrumentation.ts:130-142` — the one place that logs failures with a trace id — does not run).

**This is the highest-value change in either ADR,** and it is also the cheapest: thread the key id into `RequestContext`, and write one `admin_audit_log` row in the same statement as the mutation (see §7/§8 for why "same statement" is not automatic here).

### 3. P0 — ADR-0007's scopes have **no tenant dimension**, so a "narrow" key is not narrow

The scope vocabulary is resource-typed only: `organizations:read`, `users:read|write|purge` (`apps/admin/src/lib/admin-pem.ts:48-57`), resolved by first path segment (`:217-235`). There is no org in the credential and no org in the route. Therefore:

- `organizations:read` → `GET /api/v1/organizations` returns **all** orgs (`organization-admin.controller.ts:17-21` → `packages/server/src/services/organization.service.ts:121-164`), and `GET /organizations/{id}` returns **any** org's members, e-mails, groups and permission matrix (`organization.service.ts:184-268`). One key, every tenant.
- `users:read` → `GET /api/v1/users?search=` performs an `ilike` against `profiles.email` and `full_name` **platform-wide** (`apps/admin/src/server/services/user-admin.service.ts:172-179`). An org-scoped grant with this scope can enumerate every e-mail on the platform.
- `users:write` → `PATCH /users/{id}` rewrites `app_metadata.account_type` for **any** user (`user-admin.service.ts:282-306`). That is privilege escalation across tenants, because `account_type` is what `withAuth` reads (`packages/server/src/lib/with-auth.ts:38`) and what `routes.config.ts:46-50` routes on.
- `users:purge` → `purge-expired` sweeps **globally** (`user-admin.service.ts:63-96`).

ADR-0007 explicitly accepts this as "blast radius is its scope list" (`0007-admin-api-auth.md:60`). That was defensible for a machine key that operated the whole platform. It is **not** a basis for a per-org grant: the whole vocabulary is org-blind, so the grant cannot be expressed by narrowing a scope. The new ADR must add a tenant claim to the credential (or refuse to reuse these scopes for grants) rather than reusing `organizations:read` and hoping the handler filters.

### 4. P0/P1 — The only tenancy proof in the stack is `org_members`, and it is deliberately not forgeable

`with-auth.ts:39-63` is the load-bearing sequence: the cookie is only a hint, and `activeOrgId` is set **only if** an `org_members` row exists for `(cookie org, user)`. If there is no row, `activeOrgId` stays `null` and `permissionScopes` stays `{}` (`:44-47,66-75`), so `resolveScope` returns `null` (`authz.ts:32-49`) and every `can()`/`check()` denies. An engineer with a grant but no membership literally sees nothing — and if you "fix" that by giving the grant session a service-role client, you are back in §1.

Two designs follow, and the ADR must pick one explicitly:

- **(A) The grant is a real row.** Insert a time-boxed `org_members` row with a `support` role. Zero changes to `withAuth`, RLS, `accessibleFilter`, or any service; "same queries a member would" becomes literally true. Cost: the org sees a new member, and the row must be excluded from rosters, seat counts and `member_count` (`organization.service.ts:135-163`), plus a new `support` role that cannot be handed out (`can_assign_org_role`, `supabase/migrations/20261024124756_rls_all_public_tables.sql:216-244`) and cannot be self-granted.
- **(B) The grant is a claim.** New resolver in `withAuth` that derives `activeOrgId` from a grant token. This is the one that reads best in an ADR and is the one §1 disqualifies, unless every org-scoped query path is first made fail-closed (`orgId` required, `any` removed). That is a large, testable, but non-trivial prerequisite.

The honest ordering is: **(B) is only sound after §1 is closed; (A) is sound today.** If the ADR wants (B), §1 is a blocking prerequisite, not a follow-up.

### 5. P1 — A synthetic "support role" escalates to org manager unless its feature rows are seeded

If (A) is chosen, the role must not inherit the plan fallback. `has_org_feature` (`20261024124756_...:109-191`) grants access via three routes; the third is: **if the role has no `org_role_features` rows at all**, fall through to the org/seat plan's features (`:138-188`). `is_org_manager` is defined as `has_org_feature(..., 'member.manage')` (`:199-207`). So a freshly-created `support` role with zero feature rows on a plan that includes `member.manage`/`role.builder`/`org.manage` becomes an **org manager** — able to rewrite membership and roles. The admin-only strip at `:158-168` only applies to _seated_ actors, so it does not save you.

The system roles get explicit rows from the trigger (`supabase/migrations/20260707000006_handle_new_organization_trigger.sql:52-73`); a new role created by an ADR-driven migration will not. The ADR must state: the support role is created with **explicit all-disabled** `org_role_features` rows, `is_system = true`, and a name that `can_assign_org_role` refuses to hand out. Without that sentence this design has a one-line escalation.

### 6. P1 — Not every table is org-addressable, so "the org's data" is not a well-defined set

`quiz_attempts` (`supabase/schemas/39_quiz_attempts.sql:6-18`), `student_answers` (`42_student_answers.sql:7-21`), `user_daily_activity` (`52_user_daily_activity.sql:8-19`), `flashcard_practice`, `flashcard_review_state` and `flashcard_study_sessions` (`45`/`46`/`47`) have **no `organization_id`**. They are reachable only by joining through `teacher_assignments.organization_id` or through `profiles → org_members`, and a user may belong to several orgs, so their activity is not attributable to one.

The ticket the operator explicitly wants to design for — _"org crashed, we can't access anything"_ — is mostly answered from exactly these tables (attempts, answers, reviews, daily activity). So either the grant's scope is honest and says "content tables only, learning analytics are not org-addressable", or the ADR adds the column/derivation. Pretending the org filter covers "the org's data" when half the interesting tables have no org column is how this gets retrofitted after the first incident.

### 7. P1 — Aggregate and export surfaces are the widest queries in the codebase

- `organization.service.ts:135-163` fetches `org_members`, `groups`, `org_roles` for **all** orgs with `.in('organization_id', orgIds)` and counts **in JS**. PostgREST's 1000-row cap (the project already documents this trap at `stats.service.ts:113-115`) means member/group/role counts silently undercount once the platform passes ~1000 rows in any of those tables. A grant-scoped variant of this endpoint inherits the bug _and_ the cross-tenant read.
- `admin_platform_stats` / `admin_daily_stats` (`supabase/migrations/20261027120000_admin_platform_stats.sql`) are gated by `auth.role() IS DISTINCT FROM 'service_role'` (`:31-34`, `:105-108`) — a _role_ check, not an identity check. Any service-role client is "the admin". That is the correct gate for a global dashboard and the **wrong** precedent for the grant model: the grant must be narrower than the DB role it runs as, which means the filter, not the role, is the control.
- Storage: `admin_platform_stats` counts `storage.objects` (`:78-84`) directly. `org-logos` and `assignment-images` buckets are public-read (`supabase/migrations/20260920000002_org_branding.sql:18-32`; `20260713000001_teacher_assignments.sql:134-159`), so grant-scoped _data_ access does not imply grant-scoped _object_ access — an agent handed a logo URL can fetch any org's object without the panel at all. If the ADR claims "no wider query path", it must say that storage is out of scope or add signed URLs.
- There are no CSV/export endpoints today (good), and no realtime subscriptions in either app (good). Both are future risks worth stating explicitly so they are not added under a grant-scoped key without a review trigger.

### 8. P1 — Audit rows will be destroyed by the very operations they must record

`supabase/schemas/04_profiles.sql:8` (`profiles.id → auth.users ON DELETE CASCADE`) and `65_payments.sql:14-15` (`payments.user_id → profiles CASCADE`, `organization_id → organizations SET NULL`) show the existing convention: child rows die with the subject. If `admin_audit_log.subject_user_id`/`organization_id` follow that convention, then:

- `purgeNow` → `deleteAccount` → `auth.admin.deleteUser` (`user-admin.service.ts:136`) cascades away the profile, its payments, **and the audit rows describing the purge**. The one operation that most needs an audit trail is the one that erases it.
- Deleting an organization (`organization.service.ts:320`) cascades to `org_roles`, `org_members`, `groups` (`03`/`05`/`56` schemas, `ON DELETE CASCADE`).

The smallest fix that closes it: audit rows store **denormalized identifiers as `text`/`uuid` with no FK**, plus actor, key id, grant id, before/after snapshot hash, `trace_id`; and the table is append-only (no `UPDATE`/`DELETE` grant to `authenticated` or `service_role`, writes only via a `SECURITY DEFINER` function). That is one migration and it is non-negotiable if the audit claim is to mean anything.

### 9. P1 — Multi-step admin writes have no transaction, so "mutation ⇒ audit row" is not atomic

PostgREST gives no cross-statement transaction. Today:

- `deleteAccount` (`user-admin.service.ts:112-142`) deletes seat assignments, then `user_feature_overrides` granted by the user, then calls GoTrue. Any failure leaves a partially deleted account **and** (with an audit table bolted on naively) an audit row claiming an outcome that did not happen.
- `softDeleteUser` (`:331-350`) bans first, then writes markers — deliberately, and documented at `:326-330`.
- `purgeExpired` runs on **every** `listUsers()` (`:63-96`, called at `:199`) in batches of 100, i.e. up to 300 sequential round trips on a `GET /api/v1/users`.

The smallest closure: for the irreversible paths (`purgeNow`, `purge-expired`, `deleteAccount`, `apply_org_plan`), move the whole sequence into one `SECURITY DEFINER` RPC that writes the audit row in the same transaction and asserts the grant is still live at write time. Everything else can keep the "write audit after success, include `outcome`" pattern. Never let the audit row be written by the _client_ or by a separate PostgREST call.

### 10. P1 — Agent credentials: the stack offers two options, neither both short-lived and org-bound

The assignment asks what makes an agent's credential safe to mint and hard to reuse. From the code:

| Option                  | Path                                        | TTL                     | Revocation                                      | Replay                               | Org binding                                                         |
| ----------------------- | ------------------------------------------- | ----------------------- | ----------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------- |
| Supabase user + session | `withAuth` (`with-auth.ts:32`), RLS applies | refresh token lifetime  | delete user / ban (`user-admin.service.ts:331`) | session cookie is a bearer token     | **client-supplied cookie**, proven against `org_members` (`:39-63`) |
| Ed25519 key             | `apps/admin/src/proxy.ts:98-135`            | `expiresAt` only if set | **env edit + restart** (ADR-0007 `:71-73`)      | ±5 min, no nonce (`admin-pem.ts:19`) | **none** (§3)                                                       |

The Supabase-session option is the only one where the database, not the service, enforces tenancy — which is exactly the property the operator wants ("same queries a member would"). But its org selector is a cookie, and `withAuth` correctly refuses to trust it without a membership row, so §4(A) _is_ the agent design too. The Ed25519 option is org-blind, non-revocable without a restart, and replayable by an identical request — usable for CI, not for a 4-hour support grant.

The ADR needs to state: agent grants are minted as rows (user + temporary membership + grant row), never as a keyring entry; the grant row carries `ticket_ref`, `org_id`, `scopes`, `issued_by`, `expires_at`, `revoked_at`; revocation is a DB write effective on the next `withAuth` (sub-second), and the DB re-checks `expires_at`/`revoked_at` inside the mutating RPC so a cached `RequestContext` cannot outlive it. A `403` on revoke-mid-request is the acceptance test.

### 11. P2 — Operational cost: 1000 MAU vs 100k, and why the audit table is not an MAU problem

- **The org predicate is cheap.** Content tables lead with `organization_id` (`30_flashcards.sql:33-38`, `34_flashcard_decks.sql:27-28`, `57_question_banks.sql:28-29`, `31_topics.sql:24-25`, `24_questions.sql:29`). Making the predicate mandatory costs nothing at 1000 or 100k. The tables that would need new composite indexes are the analytics ones (`quiz_attempts.completed_at`, `user_daily_activity.date` — both single-column today), and those already need the org column from §6.
- **Dashboard aggregates are the first thing to break.** `admin_platform_stats` does full `COUNT(*)` over `profiles`, `flashcards`, `questions`, `question_banks`, `quiz_attempts`, `storage.objects` on every page load (`20261027120000_admin_platform_stats.sql:36-86`). At 1000 MAU that is tens of milliseconds; at 100k users / millions of cards it is multi-second and uncached (`STABLE`, not materialized). The ADR should require a materialized view or a snapshot table refreshed on a schedule before this is exposed to a grant-scoped audience.
- **`GET /users` gets slower as the trash grows**, because `purgeExpired()` is a write path on a read path (`user-admin.service.ts:14-16`). It needs to become a scheduled job before `users:read` is handed to agents that poll.
- **Audit growth is driven by agent request rate, not by MAU.** Two support humans at 200 requests/day ≈ 146k rows/year — trivial. One agent polling at 1 req/s ≈ 31M rows/year. Therefore: **audit mutations and grant lifecycle, not reads** (reads go to OTel/Tempo, correlated by `x-trace-id`; `request-instrumentation.ts:66-73` already provides it, the admin app just does not use it). With that split, monthly `RANGE` partitions on `created_at` + 24-month retention + a daily `sha256` digest over the day's rows (anchored outside the DB) is enough at both scales, and hash chaining per-row is unnecessary complexity at 1000 MAU.
- **Duplicated implementations will drift.** `createServiceClient` exists verbatim in `packages/server/src/lib/supabase/service.ts:3-13` and `apps/admin/src/lib/supabase/service.ts:3-13`. A grant-aware client factory must be one module, or the second one will be the one that forgets the grant.

---

## Decision

If the grant model is to hold, the two ADRs must state these invariants. They are ordered by what unblocks what.

1. **Tenancy is mandatory in the type system, not optional in a filter.** `buildQueryFilter`/`accessibleFilter` must lose the `{}` (`any`) return for grant-bound contexts (or `any` must be rejected at mint time), and every org-scoped query must take a non-nullable `orgId`. Until this is true, no service-role grant path is safe (§1).
2. **The grant is a row, not a key.** A grant = temporary `org_members` row (or an equivalent row the DB can evaluate) + `org_access_grants(id, org_id, principal_id, scopes, ticket_ref, issued_by, expires_at, revoked_at)`. `withAuth` remains the single place that decides `activeOrgId`; it gains grant expiry, not a new bypass (§4).
3. **No `any` for support principals, ever.** Support scopes are an explicit allow-list of permission keys, resolved through `org_role_permissions` on the support role, and the support role is `is_system`, non-assignable, and seeded with **explicit all-disabled** `org_role_features` so the plan fallback cannot fire (§5).
4. **The actor reaches the DB.** Key id / principal id / grant id / `trace_id` are threaded from the proxy into `RequestContext` and written by the mutation itself. `x-admin-key-id` being set and never read is a bug, not a limitation (§2).
5. **Audit is append-only, FK-free, same-transaction for irreversible writes.** No cascade from `profiles`/`organizations`; a `SECURITY DEFINER` RPC owns purge/plan/role mutations and writes the row atomically (§7, §8, §9).
6. **The admin panel is not on the public front door.** The UI is unauthenticated by design (`ADM-SEC-02`), so the ADR must name the network/identity gate (private network, SSO proxy, or mTLS at the edge) as a _requirement_, not an assumption, and add a check that refuses to serve `/api/*` to a non-internal origin.
7. **Storage and analytics are named exclusions or included explicitly.** Public buckets and org-less analytics tables are outside "org-scoped" unless the ADR says otherwise (§6, §7).

---

## Consequences

### Positive

- Invariant 1 alone removes the entire class of "forgot the org filter" bugs, not just the admin panel's — it is the same helper every service uses.
- Making the grant a row means the database, not the panel, is the enforcement point; a compromised service-role client still cannot resolve a different `activeOrgId`.
- The org predicate is index-supported on every content table, so the narrow design is cheap to run at both 1000 and 100k MAU.
- FK-free audit survives the operations it records, which is the only property that makes the log worth having.
- Agents and humans share one credential shape, so revocation, TTL and audit are one mechanism.

### Negative

- Option (A) makes support visible as org membership: rosters, `member_count`, seat counts and `ADM-ORG-02`'s "Członkowie 4" must all learn to exclude it, or the QA contract breaks on the next run.
- Option (B) is blocked behind a repo-wide fail-closed refactor of `buildQueryFilter`; that refactor will touch every service in `packages/server/src/services` and is the real cost of the "same queries a member would" model.
- Audit-on-write plus same-transaction RPCs means moving `purgeNow`/`purge-expired`/`apply_org_plan` off PostgREST chains into SQL functions — more migration surface than the grant model itself.
- The plan-feature fallback (§5) is a live escalation vector every time a new role is introduced; the invariant is only as good as the seeding migration.
- Per ADR-0007's existing negatives, the browser still cannot sign (`apps/admin/src/lib/api.ts:6-10`), so all of this stays invisible to the panel UI until the DB-token work lands.

---

## Verdict

**The intent is sound; the current stack cannot express it as written.**

The operator's model — narrow, time-boxed, per-org, same-queries-as-a-member, no god mode — is the right target, and the codebase has one genuinely strong primitive for it: `withAuth` refusing to trust the org cookie without an `org_members` row (`with-auth.ts:39-63`). Build the grant _on_ that primitive and the model is not just sound but cheap, because RLS, `accessibleFilter`, and every existing service keep working unchanged.

The model as an ADR usually reads — a signed token carrying `org_id`, a grant-bound service client, `if (grant.orgId) filter` — is **not sound here**, and the reason is not hypothetical: three current code paths already collapse to "no org filter" (`resolveFilterType` → `any`, `search_flashcards` null params, `buildQueryFilter` → `{}`). Under a service-role client those are platform-wide reads today, one `if` away from being exploitable. Add to that an org-blind scope vocabulary (§3) and an actor that never reaches the database (§2), and the first incident would be exactly the one the operator wants to prevent.

So: accept the goal, reject the token-with-optional-filter shape, and make the two ADRs accept §1–§5 as preconditions rather than consequences.

---

## The 5 hardest questions (blocking)

1. **Is the grant a row or a claim?** If a claim, do you accept that `buildQueryFilter`/`accessibleFilter` returning `{}` for `any` (`authz.ts:106-107`, `:290-291`) must be removed repo-wide _before_ the grant ships? If a row, does support appear in the org roster, and who accepts that (`ADM-ORG-02` counts members)?
2. **Where is the network gate, and who owns it?** `ADM-SEC-02` says the UI is unauthenticated and the API is the only boundary; `apps/admin` runs on `:4000` with no allowlist in code. Is the panel behind a private network / SSO proxy, and is that a deploy-time requirement the ADR can assert?
3. **What is the grant's ceiling when the org is broken?** "Org crashed, nobody can log in" means the support engineer may need `org_roles`/`org_members`/`organizations` **write** access to repair it. Does the grant ever include write, and if so, how is a manager-level repair distinguished from an account takeover?
4. **Does the audit cover reads or only writes?** If only writes, an agent can exfiltrate an entire org's roster and content with zero audit rows. If reads too, the table is a 31M-row/year time series at agent request rates — which do you accept, and what is the retention/legal position?
5. **Are learning-analytics tables in scope?** `quiz_attempts`, `student_answers`, `user_daily_activity`, `flashcard_practice`, `review_state`, `study_sessions` have no `organization_id`. Either the ADR adds/derives one (migration + backfill, and users in several orgs need a rule) or it states that support cannot see them — which directly limits the "org crashed" ticket.

_Minor process note: `docs/decisions/` contains two files numbered `0007` (`0007-admin-api-auth.md`, `0007-manager-plan-model.md`); this record takes `0008`, and the collision is worth fixing before a third lands._
