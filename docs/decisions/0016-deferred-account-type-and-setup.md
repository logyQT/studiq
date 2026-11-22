# ADR-0016: Deferred account type and a single first-run setup flow

**Status:** Proposed (draft for review)
**Date:** 2026-11-22
**Related:** [#1262](https://github.com/logyQT/studiq/issues/1262) (tracking), #311, #1192,
[ADR-0015](0015-role-based-authority.md) (persona is not authorization),
[ADR-0007](0007-manager-plan-model.md) (manager plans)
**Verified against:** `c9c14138` on `main` — every "today" claim in §3 was read from
the named file, not inferred from the issue.

---

## 1. Decision summary

1. **Sign-up asks for name, e-mail and password only.** The persona value
   (`student`, `educator` or `manager`) is chosen on the first screen of setup,
   written server-side, and followed by a session re-mint before any typed API is
   called.
2. **There is exactly one first-run route: `/setup`.** It is not one route per
   persona and not one route per step. A single state resolver decides the step;
   persona selects copy and available actions inside the shell.
3. **The route rule becomes `requireAuth` only.** `/setup` no longer carries
   `allowedAccountTypes`; authority is not widened because the APIs still gate
   themselves (`POST /organization` allows educator and manager; invitation
   acceptance is bounded by the token and the inviter's authority; "skip" is a
   navigation).
4. **Untyped is a first-class gated state.** Until the persona is answered, the
   proxy allows only `/setup` and sign-out; `withAuth()` keeps answering `401` on
   every data API; one session-only endpoint writes the answer.
5. **The held plan is `personal_plan_key IS NULL`**, not a `pending` catalogue
   row. Both defaults (`'student'`, `'free'`) are dropped so "no answer" cannot be
   recorded as a real answer.
6. **Joining is one component for every persona, including managers.** Accepting an
   invitation never depended on persona — only the old routes did. Managers gain
   the join outcome without a new route or a new branch.
7. **The shell owns every mutation and cache invalidation.** No setup page calls
   `apiPost` or `invalidateQueries` itself; one hook does, so the three copies of
   that block cannot drift.
8. **The old setup surface is deleted, not wrapped.** `/setup/join`,
   `/setup/classroom`, `/setup/org` and `/app/join` go away, together with
   `SetupHeader`; links, breadcrumbs, i18n and the QA cases move in the same PR.
9. **Invitations carry `target_account_type`.** An invited account is typed at
   sign-up from the invitation and never sees the persona step.
10. **Steps are state, not history.** Transitions use `replace` and completion is
    derived from `account_type` plus membership rows, so refresh resumes and the
    back button cannot re-enter a finished step.
11. **The guided portion is one checklist**, fed by
    `getOnboardingSteps({ persona, membership })`, not a tour library, and it
    ships with step events.
12. **#1262's `/onboarding` name becomes `/setup`.** The tracking issue's
    acceptance text is updated when this lands so the record and the issue cannot
    disagree.

## 2. Why a single route

The current surface encodes persona in the path, and every bug in this area comes
from that:

- `routeRules` (`packages/server/src/config/routes.config.ts`) makes `/setup`
  educator-only, `/setup/org` manager-only, and `/app/*` student-only. A student
  who wants to join a class is sent through the dashboard route (`/app/join`);
  an educator through `/setup/join`; a manager has no join route at all.
- The same two mutations are implemented per page: invitation acceptance in
  `/setup/join` **and** `/app/join`, organization creation in `/setup/classroom`
  **and** `/setup/org`, each with its own copy of the orgs/permissions/features/
  question-reports invalidation.
- `SetupHeader` encodes path-specific back rules, and its comments record the
  cost: a duplicate organization from history navigation (#306), a stale org list
  bouncing the user back (#305, #310), and a toast destroyed by a reload (#316).
- The guidance is duplicated too: two checklist components with separate copy,
  completion queries and dismiss keys.

Adding `/onboarding` next to that (the earlier draft) would have created a second
shell with the same divergence. One route with one resolver is the only shape
where a new step cannot forget the guard or the cache invalidation.

## 3. Verified current state

| Area                | Today                                                                                                                                                                              | Consequence for this ADR                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Sign-up             | `/register` requires `accountType`; `/join?token=…` asks for it too, defaulting to `student`.                                                                                      | Both selectors are removed; an invitation must supply the type.                        |
| Invitations         | The row carries `target_org_role_id` / `target_group_role`, **no** account type.                                                                                                   | Org role (Admin / Teacher / Member) does not map 1:1 to persona. Add the column.       |
| Accept API          | `acceptInvitation` checks the token, inviter authority and the org seat limit; it has **no** persona gate.                                                                         | One join component can serve every persona. The old UI routes were the only blocker.   |
| Create API          | `POST /api/v1/organization` wraps `withAuth(..., { allowedAccountTypes: [EDUCATOR, MANAGER] })`.                                                                                   | A persona-free `/setup` UI cannot let a student create an org.                         |
| Setup routes        | `/setup` chooser (educator), `/setup/join` (educator), `/setup/classroom` (educator), `/setup/org` (manager), `/app/join` (student).                                               | All become one `/setup`; the inside is components.                                     |
| Mutations           | Three copies of accept/create + invalidation across the setup pages and `/app/join`.                                                                                               | One hook replaces them.                                                                |
| Classroom creation  | `/setup/classroom` posts `/api/v1/organization`; the service creates the org and a default group. A "class" **is** an organization.                                                | One create component with persona copy, not two routes.                                |
| Staff gating        | `/edu` and `/manage` redirect to setup while the settled org list is empty (`resolveNeedsOnboarding`, #305).                                                                       | The shell reuses the settled rule; students are never forced.                          |
| Header / history    | `SetupHeader` has per-path back rules; pages use `replace` to keep finished steps out of history.                                                                                  | The shell owns navigation; no back into the type step.                                 |
| Guidance            | Two checklist components (`components/app/…`, `components/edu/…`) with separate `localStorage` keys.                                                                               | Merge behind one config. No tour dependency exists.                                    |
| Type at minute zero | `handle_new_user()` raises without a type and derives `base`/`lite`/`solo`; `profiles.account_type` is `NOT NULL DEFAULT 'student'`; `withAuth()` answers `401` without the claim. | Nullable type + null plan, defaults dropped, fail-closed unchanged.                    |
| API inventory       | `__tests__/unit/proxy/api-auth-inventory.test.ts` treats any handler without `withAuth()` as public.                                                                               | The session-only endpoint needs a third category.                                      |
| QA                  | `ONB-01 … ONB-10`; `ONB-06` asserts `/app/join`, `ONB-02/03/04` the old setup paths.                                                                                               | Cases and specs move with the routes in the same PR; `ONB-09` (`/join`) is unaffected. |

Two claims from the first draft are withdrawn: the "27 leaf combinations" were a
hypothetical no user could produce, and "personal workspace provisioning" does not
exist — a standalone student simply uses `/app`.

## 4. Decision detail

### 4.1 One route, one resolver

```ts
type SetupState =
  | { step: 'loading' }
  | { step: 'type' }
  | { step: 'action'; persona: AccountType; actions: SetupAction[] }
  | { step: 'done'; destination: '/app' | '/edu' | '/manage' };

type SetupAction = 'join' | 'create' | 'skip';
```

`resolveSetupState({ accountType, orgsCount, isPending, isFetching })` lives in
`apps/web/src/lib/setup.ts` and is the only place that decides where a first-run
user is. It keeps the settled rule from #305 (`!isPending && !isFetching`) so it
never acts on stale cached orgs.

| Persona  | Resolves to                                                                       | Forced into `/setup`?               |
| -------- | --------------------------------------------------------------------------------- | ----------------------------------- |
| untyped  | `type`                                                                            | yes, by the proxy                   |
| student  | `action` (`join`, `skip`) while no org; `done` once a member                      | no; `/setup` is opt-in              |
| educator | `action` (`create`, `join`) while the settled list is empty; `done` once a member | yes while the settled list is empty |
| manager  | `action` (`create`, `join`) while the settled list is empty; `done` once a member | yes while the settled list is empty |

A student who chooses `skip` is not redirected back: `done` is not persisted, so
re-opening `/setup` offers the action again, which is the point of an opt-in
surface. For staff, an empty settled list is the forced case, exactly as
`resolveNeedsOnboarding` does today.

The route has no step segments. A step URL is a second place that must remember to
run the guard, which is the defect this ADR exists to remove. A `/setup/join` deep
link can be added later only as an alias that runs the same resolver first.

Steps are never pushed onto history. Choosing a type or finishing a mutation
changes the derived state and renders the next step; the browser's back cannot
re-open a finished step, and an explicit control is the only way back to the
persona screen (and that control never returns there after the write — a later
change goes through settings, §4.10).

### 4.2 The gate

Three independent pieces, all server-side:

1. **Proxy.** An authenticated session with no `app_metadata.account_type` is
   allowed only `/setup` and the sign-out path; every other request redirects to
   `/setup`. `/login` and `/register` gain the untyped redirect (today a missing
   type matches no `redirectIfAuthenticatedByAccountType` key, so an untyped
   session can sit on the login form).
2. **`withAuth()` is unchanged.** No valid claim is `401` on every data API, which
   is what makes the gate real even if a client bypasses the proxy.
3. **One endpoint, one guard.** `POST /api/v1/onboarding/account-type` uses a new
   session-only guard (a user, no permission check, no `account_type`
   requirement). It validates the enum and calls one `SECURITY DEFINER` function
   that updates `profiles.account_type`, `profiles.personal_plan_key` and
   `app_metadata.account_type`, so the row and the JWT claim cannot diverge. It is
   idempotent: the same value is `200`, a different value after the first write is
   `409`.

The handler cannot call `withAuth()`, so
`__tests__/unit/proxy/api-auth-inventory.test.ts` needs a `SESSION_ONLY_API`
category with two assertions: the route really uses the session-only guard, and it
really rejects an unauthenticated caller. Putting it in `PUBLIC_API` would be a
lie and would exempt it from the check that matters.

### 4.3 The held plan

While `account_type IS NULL`:

- `profiles.account_type` becomes nullable and **loses `DEFAULT 'student'`**. The
  default is the dangerous part: a missing answer would otherwise be recorded as a
  real persona with a real dashboard and a real plan.
- `profiles.personal_plan_key` becomes nullable and loses its default. No
  `pending` plan is added: `subscription_plans.scope` is `NOT NULL` and a personal
  plan requires a non-null `audience`, so a held key forces a fake catalogue row
  that every plan read, checkout rule and public pricing query must exclude. The
  entitlement resolver already treats a missing personal plan as a zero layer
  (with a warning), which is exactly "no plan yet".
- `handle_new_user()` inserts `NULL` for both when the type is absent but still
  raises for a type that is present and invalid. "No answer" and "typo" must not
  collapse.
- Checkout and plan reads must answer a domain error, not `500`, for a null plan.

The answer is one server-side write (`account_type` + the family's free plan + the
claim), followed by `refreshSession()` (or re-login). The shell does not advance
until the new token is in place, so the action step can never call a typed API with
the old claims.

### 4.4 One shell, three bodies

```
/setup
  <SetupTypeStep />      three cards; writes the persona; re-mints; no back
  <SetupActionStep />    options from the persona/state table
  <SetupJoinForm />      code or link → preview → accept; every persona
  <SetupCreateForm />    name → optional invites (educator) → create; educator/manager
  <SetupDone />          one paint, then the persona's destination
```

| Persona    | Join outcome                                             | Create outcome                                     |
| ---------- | -------------------------------------------------------- | -------------------------------------------------- |
| `student`  | `/setup` → accept → `/app` (or `/setup` → skip → `/app`) | not offered; the API refuses it                    |
| `educator` | `/setup` → accept → `/edu`                               | classroom copy + optional student invites → `/edu` |
| `manager`  | `/setup` → accept → `/manage`                            | organization copy → `/manage`                      |

Persona changes copy, defaults and which action is offered. It changes no route,
no guard and no API. This is also the sixth outcome the earlier draft had to exclude:
the accept API never gated on persona, so a manager can redeem an invitation once
the UI stops routing them away from it.

### 4.5 Mutation and invalidation ownership

`useSetupFlow()` is the only caller of the three writes and the only place that
invalidates:

1. `setType` → session-only endpoint → `refreshSession()` → recompute state.
2. `acceptInvite` → `/api/v1/organization/invites/accept` (the response already
   sets `active_org_id`) → invalidate `['orgs']` with `refetchType: 'all'`, then
   permissions, features and question reports → resolve the destination.
3. `createOrg` → `POST /api/v1/organization` (the response sets `active_org_id`)
   → the same invalidations → the same destination resolution.

No page-level `apiPost`, no per-page invalidation list, no page-level
`router.push` after a mutation. The destination is computed once by the resolver
and reached with `router.replace`, so `/setup` never remains in history. Submit
buttons are disabled in-flight; the create path is not idempotent server-side
(today's behaviour), so the shell must not offer two live submits.

### 4.6 What is deleted, and what moves

| Removed                                                                                                | Replaced by                                              |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `/setup` chooser (two buttons)                                                                         | `/setup` action step, options from the resolver          |
| `/setup/join`                                                                                          | `/setup` join action                                     |
| `/setup/classroom`                                                                                     | `/setup` create action, educator copy + optional invites |
| `/setup/org`                                                                                           | `/setup` create action, manager copy                     |
| `/app/join`                                                                                            | `/setup` join action (the org switcher links there)      |
| `SetupHeader` and its per-path back rules                                                              | the shell's header, one rule for every step              |
| `SetupPage` + `Onboarding` i18n namespaces (including the unused `solo_option`/`join_org_option` keys) | one `Setup` namespace                                    |
| breadcrumb entries for the removed paths                                                               | one `/setup` entry                                       |
| `ONB-01…06` URL/step assertions and their case documents                                               | the same cases through `/setup`                          |

`/join?token=…` (signed-out registration with an invitation) stays. The invitation
is still accepted at the activation callback, so an invited account lands typed,
with membership, and never enters `/setup` unless acceptance failed.

Pre-market rules apply: the old routes are deleted, not redirected. Their only
internal links (org switcher, breadcrumbs, header) are updated in the same PR.

### 4.7 Invitations carry the persona

Add `invitations.target_account_type` (same enum as `profiles.account_type`,
`NOT NULL`). The inviter picks it with the role, or the form derives a default and
lets the inviter change it. The public preview returns it for display only; the
registration service writes it from the invitation row into the sign-up metadata,
so a modified client cannot choose a different persona. The trigger then types the
account at creation, which is why an invited user never sees the type step.

This is required: the token currently carries an org/group role, and
`Admin → manager` is wrong for a co-teacher, so no role-to-persona map can replace
the column.

### 4.8 The guided portion is a checklist

`getOnboardingSteps({ persona, membership })` returns step descriptors (label key,
href, completion predicate key). One component renders them and replaces the two
existing checklists. Completion is derived from existing endpoints (orgs, members,
groups, stats); no new table and no new API.

Dismissal stays in `localStorage` for v1. It is per browser, not per account; that
is a recorded limitation, not silent behaviour. An overlay tour (driver.js,
shepherd, joyride) is not adopted: it adds a dependency, a second step definition
set and a new failure mode on every navigation. If one is wanted later, it gets its
own ADR.

### 4.9 Instrumentation

One event per transition through the existing OTel log pipeline, with bounded
labels only: `setup.started`, `setup.type_selected` (persona),
`setup.action_selected` (`join` | `create` | `skip`), `setup.join_completed`,
`setup.create_completed`, `setup.abandoned`, `setup.checklist_completed`. Never
e-mail, name or free text.

There is no product-analytics sink today, so the funnel is read from Loki for the
first release; a durable funnel table or vendor is a separate decision. The events
ship with the shell because #1262 requires the numbers for the whole path and
`PRODUCT.md` forbids unmeasured claims.

### 4.10 Changing the persona later

Editable from account settings while the account has no paid personal
subscription: the profile moves to the new family's free plan (`base` / `lite` /
`solo`), and org memberships and roles are untouched (persona is not authority,
ADR-0015 §3.2). With a paid plan the request is `409 CONFLICT` until the
subscription is cancelled. Cross-audience paid-plan migration is out of scope.

## 5. Alternatives considered

| Alternative                                                                 | Why rejected                                                                                                                                                          |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Keep the old routes and add `/onboarding` beside them** (the first draft) | Two shells, two guards, the same three duplicate mutations, and a persona split across paths. The divergence survives and grows.                                      |
| **`/setup` plus step URLs (`/setup/type`, `/setup/join`, …)**               | Every step route must re-run the same guard and resolver; that is the class of defect this ADR removes. A deep link can be an alias later, still behind the resolver. |
| **One route per persona** (`/setup/student`, `/setup/educator`, …)          | Same duplication with a different name; persona already selects copy and actions without routes.                                                                      |
| **Keep the type in `/register`**                                            | The decision #1262 makes: the visitor knows least about the product at that moment, and the answer gates plan and dashboard before they have seen anything.           |
| **Store `context` (`solo` / `org`) on the account**                         | The setup action falsifies it immediately — creating a classroom creates an organization. Membership rows are the truth and already exist.                            |
| **A `pending` catalogue plan for untyped accounts**                         | Forces a fake `scope`/`audience` row that every plan read and checkout must exclude; `NULL` already composes to zero entitlements and limits.                         |
| **Two create bodies and two join bodies**                                   | The API bodies are identical; only copy and the optional invite field differ. Components cover that without duplicating the write path.                               |
| **Overlay tour library in v1**                                              | New dependency and a second step definition set for a list of links to real screens.                                                                                  |

## 6. Consequences

**Positive**

- One guard, one resolver, one mutation hook: a new step cannot bypass the gate or
  forget an invalidation.
- `POST /organization` still enforces educator/manager, so removing
  `allowedAccountTypes` from `/setup` grants no authority.
- Managers can join an organization through the shared component instead of
  needing a new route.
- Four routes, one header and two checklist copies disappear; the QA matrix is one
  route with six outcomes.
- Dropping `DEFAULT 'student'` removes the whole class of "unanswered account is
  silently a student with `base` entitlements" bugs.

**Negative / trade-offs**

- The setup work is one coordinated change: routes, links, breadcrumbs, i18n, QA
  specs and case documents move together. Splitting it would leave dead paths or
  dead links.
- `/setup` loses deep links per step. Analytics carry the step instead; if a deep
  link is required, it is an alias through the resolver.
- The route rule is wider (all authenticated personas). The safety argument is the
  API gates, and that argument needs a test: `/setup` must have `requireAuth` and
  no `allowedAccountTypes`, and a student calling `POST /organization` must still
  get `403`.
- Nullable `account_type` / `personal_plan_key` require every reader to handle
  "not chosen". The resolver and plan reads already have branches; new code can
  forget, so the null-plan checkout test is the guard.
- Dismissal remains per browser, so the checklist can reappear on another device.
- A manager who was not invited still needs the create path; there is no code-paste
  join without an invitation.

## 7. Open questions

1. **Manager org creation: self-serve or contact/invite?** #1262 leaves this open.
   This ADR keeps today's self-serve create action until the product answers; the
   answer changes copy, not the state machine.
2. **Per-account checklist dismissal.** Deferred deliberately; v1 keeps
   `localStorage`.
3. **Durable funnel storage.** v1 reads OTel logs; the transport is a separate
   decision and the flow does not depend on it.

The first draft attributed three questions to #1262 (routes/roles/flags per
outcome, whether setup blocks, shared tour steps). None appear in the issue. They
are answered here: §4.1 (blocking is persona-specific), §4.4 (the route/action
matrix) and §4.8 (shared checklist descriptors).

## 8. Implementation slices

| #   | Slice                                                                                                                                    | Decision    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | Schema: nullable `account_type` / `personal_plan_key`, drop both defaults, trigger writes `NULL` for untyped and still raises on invalid | §4.3        |
| 2   | Session-only guard + `POST /api/v1/onboarding/account-type`, idempotent; `SESSION_ONLY_API` inventory category                           | §4.2        |
| 3   | Proxy: untyped gate + `/login` `/register` redirect                                                                                      | §4.2        |
| 4   | `resolveSetupState` + `useSetupFlow` (writes, re-mint, invalidations, destination)                                                       | §4.1, §4.5  |
| 5   | `/setup` shell and the three bodies; route rule `requireAuth` only                                                                       | §4.4        |
| 6   | Invitation `target_account_type`; `/join` and `/register` lose the selector; trigger path                                                | §4.7        |
| 7   | Delete the old routes, header, i18n namespaces; update links and breadcrumbs                                                             | §4.6        |
| 8   | QA: rewrite `ONB-01…06` and their case docs through `/setup`; add the manager-join case                                                  | §4.6        |
| 9   | Merge the two checklists behind `getOnboardingSteps`                                                                                     | §4.8        |
| 10  | Events + funnel read; settings persona change with the paid-plan refusal                                                                 | §4.9, §4.10 |

## 9. Evidence

- `packages/server/src/config/routes.config.ts` — `/setup` educator-only,
  `/setup/org` manager-only, `/app` student-only.
- `apps/web/src/app/(frontend)/(setup)/setup/*`, `.../app/join/page.tsx` — the
  routes being replaced, the `SetupHeader` rules and the duplicated mutations.
- `apps/web/src/app/(backend)/api/v1/organization/route.ts` — creation gated to
  educator/manager; `invitation.controller.ts` accept has no persona gate.
- `packages/server/src/models/auth.model.ts` — `RegisterSchema.accountType`
  required; `with-auth.ts` — `401` without the claim.
- `supabase/migrations/20261122150000_plan_scope_audience_solo.sql` — the trigger
  raises on a missing type and derives `base`/`lite`/`solo`;
  `profiles.account_type` is `NOT NULL DEFAULT 'student'`.
- `packages/server/src/services/entitlement.resolver.ts` — a null personal plan
  composes as no personal layer.
- `apps/web/src/lib/onboarding.ts` — the settled-orgs rule to preserve.
- `apps/web/src/components/{app,edu}/onboarding-checklist.tsx` — the two checklists.
- `__tests__/unit/proxy/api-auth-inventory.test.ts` — a handler without
  `withAuth()` is treated as public.
- `__tests__/qa/ONB/ONB-01 … ONB-10` — the cases whose URLs move.
