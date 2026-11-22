# ADR-0016: Deferred account type and a single first-run setup flow

**Status:** Proposed (draft for review)
**Date:** 2026-11-22
**Related:** [#1262](https://github.com/logyQT/studiq/issues/1262) (tracking), #311, #1192,
[ADR-0015](0015-role-based-authority.md) (persona is not authorization),
[ADR-0007](0007-manager-plan-model.md) (manager and org plans)
**Verified against:** `c9c14138` on `main`. Every "today" claim in §3 was read from
the named file; two claims in the first draft were wrong and are corrected there.

---

## 1. Decision summary

1. **Sign-up asks for name, e-mail and password only.** Passwordless sign-up is the
   sibling issue; this ADR does not change the credential fields. The persona
   (`student`, `educator` or `manager`) is chosen on the first screen of setup and
   written server-side.
2. **There is exactly one first-run route: `/setup`.** Not one route per persona,
   not one route per step. A single resolver decides the step; persona selects
   copy and available actions. Members use `/setup?intent=join` for "join another
   organization".
3. **The route rule becomes `requireAuth` only.** Authority is not widened: the
   APIs keep their own gates (`POST /organization` allows educator/manager;
   invitation acceptance is bounded by the token and the inviter's authority;
   "skip" is navigation).
4. **Untyped is a first-class gated state.** The proxy must stop coercing a missing
   claim to `student`; the untyped redirect runs before every account-type
   redirect. Until the persona is written, product routes are unreachable and
   `withAuth()` still answers `401` on every data API.
5. **The persona is written through the service role only.** The trigger's
   `raw_user_meta_data` fallback is removed, because with the public anon key a
   client can otherwise self-declare `manager` at GoTrue signup.
6. **The session is refreshed server-side after the write**, because the access
   token is what Postgres RLS reads. There is no browser Supabase client, so the
   refresh cannot be a `refreshSession()` call in the page.
7. **The held plan is `personal_plan_key IS NULL`**, not a `pending` catalogue
   row. The migration defaults and the seed default are both removed, or
   `db reset` silently makes every untyped account a student with `base`.
8. **Org creation is self-serve for managers, visually non-peer.** There is no
   sales gate in onboarding: the catalogue already makes the top plan (`campus`)
   contact-only while `launch`/`team`/`hub` are self-serve, and billing is
   org-scoped with a `purchaser_user_id`, so a holding buys one plan per org or a
   campus contract. Multi-org purchasing UI is out of scope.
9. **Joining is one component for every persona.** Accepting an invitation never
   depended on persona; the old routes were the only blocker. A manager can join
   an organization; a member can join another one through `?intent=join`.
10. **Setup is blocking for staff and optional for students.** An educator/manager
    with a settled empty org list is redirected to `/setup`; a student with no org
    keeps `/app`, and `/setup` offers join or continue.
11. **One hook owns every write and invalidation.** The destination comes from the
    mutation response or the refreshed query data, not from a stale closure.
12. **The old surface is deleted, not wrapped**, and every link site moves in the
    same release (steps 7–8) — including `manage/layout.tsx`, which would
    otherwise 404 every manager's first login.
13. **Steps are state, not history.** Transitions use `replace`; refresh resumes
    the step from `account_type` + membership; the type step has no back, and the
    untyped shell has a sign-out.
14. **The guided portion is one checklist**, fed by
    `getOnboardingSteps({ persona, membership })`, including a "bring your
    material" step; per-browser dismissal is a recorded v1 limitation.
15. **Instrumentation ships with the type step**, not last: step events plus
    failure events, with register/activation legs read from existing spans.
16. **#1262's `/onboarding` name becomes `/setup`**, and ADR-0015's "set at
    signup" becomes "set during first-run setup", so the records do not disagree.

## 2. Why a single route

The current surface encodes persona in the path, and every bug in this area comes
from that:

- `routeRules` makes `/setup` educator-only, `/setup/org` manager-only, and
  `/app/*` student-only. A student joining a class goes through a dashboard route
  (`/app/join`); an educator through `/setup/join`; a manager has no join route.
- The same mutations are implemented **four** times (`/setup/join`, `/app/join`,
  `/setup/org`, `/setup/classroom`), and the bodies are not identical:
  `/setup/classroom` also posts `/invites/bulk` and needs `memberRoleId` from the
  create response.
- `SetupHeader` encodes path-specific back rules, and its comments record four
  bugs caused by the split: a duplicate organization from history (#306), a stale
  org list bouncing the user back (#305, #310), and a toast destroyed by a reload
  (#316).
- Guidance is duplicated too: two checklists with separate copy, completion
  queries and dismiss keys.

Adding `/onboarding` beside that (the first draft) would have created a second
shell with the same divergence. One route with one resolver is the only shape
where a new step cannot forget the guard or the invalidation.

## 3. Verified current state

| Area                | Today                                                                                                                                                                    | Consequence                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Sign-up             | `/register` requires `accountType`.                                                                                                                                      | Remove the field; the trigger must accept an untyped account.                             |
| Invite registration | `/join?token=…` does **not** ask for the type; it hard-codes `accountType: 'student'`.                                                                                   | Every invited co-teacher/manager is mistyped today. The invitation must carry the type.   |
| Invitations         | Rows carry `target_org_role_id` / `target_group_role`, no account type.                                                                                                  | Add `target_account_type`; role does not map 1:1 to persona.                              |
| Accept API          | `acceptInvitation` has no persona gate; a class invite refuses a user who is not already an org member.                                                                  | One join component for all; a class invite is not a signup path.                          |
| Create API          | `POST /api/v1/organization` is `withAuth({ allowedAccountTypes: [EDUCATOR, MANAGER] })`.                                                                                 | A persona-free `/setup` UI cannot let a student create an org.                            |
| Proxy               | `resolveAccountType()` coerces a missing claim to `student`; an untyped session is sent from `/login` to `/app` and passes `/app`'s rule.                                | The gate must be null-aware and run before the account-type redirect.                     |
| `withAuth()`        | `401` without a valid claim.                                                                                                                                             | Keep unchanged; it is the real API gate.                                                  |
| Token               | Every claim read is `supabase.auth.getUser()`; there is **no** browser Supabase client. RLS still reads `auth.jwt()`.                                                    | Refresh the session server-side and set cookies; `refresh()` alone is not enough for RLS. |
| Type trigger        | `handle_new_user()` prefers `app_metadata`, falls back to client-supplied `user_metadata`, raises when missing; `profiles.account_type` is `NOT NULL DEFAULT 'student'`. | Remove the fallback, allow untyped, drop the default.                                     |
| Plan trigger        | Derives `base` / `lite` / `solo`; `personal_plan_key` is `NOT NULL DEFAULT 'free'`; `supabase/seeds/00_plans.sql:9` re-sets the default to `'base'` on every reset.      | Null plan + drop the default in the migration **and** the seed.                           |
| Types               | `packages/server/src/types/database.ts` types `account_type` non-null.                                                                                                   | Regenerate in the schema slice, or null handling reads as dead code.                      |
| Setup routes        | `/setup` chooser, `/setup/join`, `/setup/classroom` (educator); `/setup/org` (manager); `/app/join` (student).                                                           | All become `/setup`.                                                                      |
| Staff gating        | `/edu` redirects to `/setup`; `/manage/layout.tsx:14` redirects to `/setup/org`, which this ADR deletes.                                                                 | Migrate the manager redirect; the educator one survives.                                  |
| Guidance            | Two checklist components; no manager checklist; no tour dependency.                                                                                                      | Merge; add the manager descriptors and the import step.                                   |
| API inventory       | A handler without `withAuth()` counts as public, by substring match.                                                                                                     | Add a `SESSION_ONLY_API` classification; the 401 belongs in an integration test.          |
| QA                  | ONB-01…08 and ONB-10 pin the old paths or the registration type field; AUT-01/02/15…18 assert `/setup*` routing, several as a wire-level **307**.                        | Rewrite them; the 307 assertion becomes a client redirect.                                |

Two first-draft claims are withdrawn: the "27 leaf combinations" were a
hypothetical no user could produce, and "personal workspace provisioning" does not
exist — a standalone student simply uses `/app`.

## 4. Decision detail

### 4.1 One route, one resolver

```ts
type SetupState =
  | { step: 'loading' }
  | { step: 'error'; reason: 'orgs' }
  | { step: 'type' }
  | { step: 'action'; persona: AccountType | null; actions: SetupAction[] }
  | { step: 'done'; destination: '/app' | '/edu' | '/manage' };

type SetupAction = 'join' | 'create' | 'skip';

resolveSetupState({
  accountType,
  orgsCount,
  isPending,
  isFetching,
  isError,
  intent,
  token,
});
```

`apps/web/src/lib/setup.ts` is the only place that decides a first-run
destination. It keeps the settled rule from #305 (`!isPending && !isFetching`),
adds `isError` (a failed `/me/orgs` is **not** "no organizations"), and accepts
`intent: 'join'` plus a pre-filled `token` so a member can join another org.

| Persona  | Resolves to                                                                   | Forced into `/setup`?       |
| -------- | ----------------------------------------------------------------------------- | --------------------------- |
| untyped  | `type`                                                                        | yes, by the proxy           |
| student  | `action` (join, skip) while no org; `done` once a member                      | no; opt-in                  |
| educator | `action` (create, join) while the settled list is empty; `done` once a member | yes while the list is empty |
| manager  | `action` (create, join) while the settled list is empty; `done` once a member | yes while the list is empty |

`intent: 'join'` renders the join action even when the state would be `done`; the
org switcher and the "join another class" link use it. A student who skips is not
redirected back: no completion is persisted, and re-opening `/setup` offers the
action again, which is the point of an opt-in surface.

An **untyped** caller with `intent=join` and a token goes to the join action, not
the type step (`persona: null`, only the join action): the accept endpoint writes
the persona from the invitation when the caller is still untyped, so an invited
user never sees the type card on this path either. If the invitation predates
`target_account_type` (null), the shell keeps the token and falls back to the type
step before accepting.

The route has no step segments. A step URL is a second place that must remember
the guard, which is the defect this ADR removes. Deep links, if ever needed, must
be aliases that run this resolver first.

Steps are never pushed onto history. Choosing a type or finishing a mutation
changes the derived state; the browser's back cannot re-open a finished step. The
only back control returns from join/create to the action list; **no control
returns to the type step after the write** (a change goes through settings,
§4.12). Resumability is per step: `account_type` and membership survive a
refresh; a pasted code, an org name and invite rows do not.

### 4.2 The gate

Order matters; the gate runs before every account-type redirect.

1. **Null-aware claim resolution.** Replace the proxy's `resolveAccountType()`
   coercion with a resolver that returns `AccountType | null`, shared with the
   server's enum check. Keep the student fallback only for display after the
   gate, never for gating.
2. **Untyped redirect.** An authenticated session with no claim: matched product
   routes redirect to `/setup`; `/setup` and `/join` (which forwards its token)
   are allowed; public, unmatched pages (pricing, terms) pass through; `/login`
   and `/register` redirect to `/setup`. This is a per-rule predicate, not a
   catch-all, and every redirect goes through `preserveCookies` or the refreshed
   session cookies are dropped.
3. **`withAuth()` stays as it is.** It is the real API gate: an untyped session
   calling any data route gets `401`, even if it bypasses the proxy.
4. **Sign-out from the shell.** `/setup` is the only _product_ page an untyped
   user can reach (`/join` and public pages stay open), so the shell header
   renders a sign-out control (today only the dashboard user menu has one).

### 4.3 Writing the persona and refreshing the session

`POST /api/v1/setup/account-type`, session-only guard (a user, no permission and
no `account_type` requirement), body `{ accountType, mode }`:

- `mode: 'complete'` is the onboarding path: only while the profile is untyped;
  the same value is `200`, a different value (another tab) is `409` and the
  client re-reads state.
- `mode: 'change'` is settings: refused when a paid personal plan exists or a
  seat is assigned under the current persona (its `audience` would stop
  matching); otherwise it moves the account to the new family's free plan.

One `SECURITY DEFINER` function does the write: `auth.uid()` only (no user-id
parameter), `SET search_path = ''`, `REVOKE ALL FROM PUBLIC, anon`,
`GRANT EXECUTE TO authenticated`, enum validation, plan key validated against
`subscription_plans(scope = 'personal', audience = chosen)`. It updates
`profiles.account_type`, `profiles.personal_plan_key` and
`auth.users.raw_app_meta_data` together, so the row and the claim cannot diverge.

The endpoint then **refreshes the session server-side** (GoTrue refresh on the
request client, new cookies written through `setAll`) and returns. The page calls
`AuthProvider.refresh()` for the user object, but the cookie refresh is what makes
RLS see the new claim; a `refreshSession()` call from the page is impossible
because there is no browser client. If the refresh fails, the endpoint answers
`503`; the shell shows retry + sign-out and does **not** advance.

Because the handler cannot call `withAuth()`,
`__tests__/unit/proxy/api-auth-inventory.test.ts` needs a `SESSION_ONLY_API`
category. The unit test can only prove the classification (it is a source scan);
the "unauthenticated caller gets 401" assertion belongs in
`__tests__/integration/`. Putting the route in `PUBLIC_API` would be a lie. The
same test already treats a handler with a public `?token=` branch as fully gated,
so classify per exported handler (or record the exception) while adding the
category, or the new endpoints are covered by a substring accident.

The setup-events route from §4.11 uses the same guard and the same category.

### 4.4 The held plan

While `account_type IS NULL`:

- `profiles.account_type` becomes nullable and loses `DEFAULT 'student'`.
- `profiles.personal_plan_key` becomes nullable and loses its default — **in the
  migration and in `supabase/seeds/00_plans.sql`**, which currently re-sets
  `'base'` on every reset. The effective default today is `'base'`, not `'free'`.
- No `pending` plan row: `subscription_plans.scope` is `NOT NULL` and a personal
  plan needs a non-null `audience`, so a held key forces a fake catalogue entry
  that every plan read, checkout rule and pricing query must exclude. The
  resolver already composes a missing personal plan as a zero layer.
- `handle_new_user()` inserts `NULL` for both when the type is absent, but still
  raises when a type is present and invalid. "No answer" and "typo" must not
  collapse. Untyped means the `app_metadata` key is absent **or** JSON `null`;
  the gate treats both as untyped, and the trigger omits the key rather than
  writing `{"account_type": null}`.
- The seeded fixtures keep their type through `raw_app_meta_data`; the direct
  `profiles` inserts in `supabase/seeds/01_seed.sql` omit `account_type` and only
  work today because the trigger creates the row first. Once the default is gone,
  audit those inserts so no fixture becomes untyped.
- `getMyPlan` / `getPersonalPlan` already answer `NOT_FOUND`; keep that, and fix
  `plan.primary`'s fallback to `'free'`, a key the seeded catalogue does not have.
- Regenerate `packages/server/src/types/database.ts` in the same slice, or the
  null branches are typed as unreachable.

### 4.5 What gets typed, and when

- **Remove the `raw_user_meta_data` fallback** from `handle_new_user()`. With the
  public anon key, any client can POST GoTrue signup with
  `data.account_type = 'manager'`; the fallback is why that currently works.
- **New org invitations carry `target_account_type`** (nullable in the first
  migration; the create/update service requires it on new **org** invitations,
  and class invitations leave it null because they never create an account; a
  follow-up tightens the column). The inviter picks it with the role. Default by target
  role: `teacher`/`admin` → `educator`, `member` → `student`; the inviter can
  change it (an org admin may be a manager). The single, bulk (`/setup`
  classroom) and `/manage/invites` forms send it per row; `UpdateInviteSchema`
  gains the field or refuses a role edit that would leave it inconsistent.
- **An untyped caller accepting an org invitation is typed in the same write**,
  from the invitation row, before the membership is applied. That closes the
  "self-signed-up, then opened an invite link" path without asking a question the
  invitation already answers.
- **An invited account is typed at activation**, in `claimInvitation`, from the
  invitation row, with the service role. It cannot be typed at creation: a client
  cannot write `app_metadata` before its own creation, and the metadata path is
  the hole above. If acceptance fails, the account stays untyped and the join
  screen keeps the token and the failure reason; a successful retry types it.
- **A class/group invitation is not a signup path**: the RPC refuses a class
  invite unless the user is already an org member. A signed-out visitor with a
  class token is sent to sign-in, not registration. Only org invitations create
  an account.
- **An existing account** accepting an invitation keeps its persona; only the
  membership and role are granted. A mismatch is ignored, not refused.
- **Backfill**: pending rows have no intent. Derive only where unambiguous
  (`teacher` → `educator`, `member` → `student`), leave `admin` org invites null
  (they fall back to the type step), and require the column on new org rows. A
  follow-up can tighten to `NOT NULL` once no nulls remain outside class invites.
- `/join?token=…` loses its type field; when already authenticated it forwards to
  `/setup?intent=join&token=…` so a signed-in wrong account does not drop the
  token, and `SetupJoinForm` consumes it.

### 4.6 One shell, five components, six outcomes

```
/setup
  <SetupTypeStep />      two cards + institution link; writes the persona; no back
  <SetupActionStep />    join | create | skip, from the persona/state table
  <SetupJoinForm />      code or link → preview → accept; every persona
  <SetupCreateForm />    name → optional invites (educator) → create
  <SetupDone />          confirmation (today's "Gotowe!") → persona's destination
```

| Persona  | Join                          | Create                                     | Skip        |
| -------- | ----------------------------- | ------------------------------------------ | ----------- |
| student  | `/setup` → accept → `/app`    | not offered (API refuses)                  | `/app`      |
| educator | `/setup` → accept → `/edu`    | classroom copy + optional invites → `/edu` | not offered |
| manager  | `/setup` → accept → `/manage` | organization copy → `/manage`              | not offered |

**The manager is not a peer card.** The screen shows two cards (student,
educator) plus a secondary "I run an institution" link to the create step. Org
creation is self-serve; the ADR records that `/contact` is the `campus` plan's CTA
on pricing/billing (`pricing/_components/plan-row.tsx`), not an onboarding gate.
Billing already supports org-scoped subscriptions with a `purchaser_user_id`, so
an institution buys one plan per org or a campus contract; a multi-org purchasing
screen is a separate billing decision.

Card content is part of the decision, not the implementation. Required content:

| Choice           | Promise                | Consequence shown                                                                  | Destination |
| ---------------- | ---------------------- | ---------------------------------------------------------------------------------- | ----------- |
| Student card     | "I'm here to learn"    | personal space; joining a class is optional                                        | `/app`      |
| Educator card    | "I teach"              | creates an organization, you become Admin on the free plan, with seat/group limits | `/edu`      |
| Institution link | "I run an institution" | creates an organization, you become Admin; plans are bought per organization       | `/manage`   |

Every card also says the choice is changeable later (while no paid personal plan
is active, per §4.12), and the screen has no preselection. The
educator/institution wording is the one place a first-run user could otherwise be
misled by friendly copy.

`PRODUCT.md`'s `/contact` line is reconciled as the `campus` plan's CTA, not as a
manager signup path; that sentence is updated with this change.

What a good first session must achieve, and what the checklist is measured
against: a student sees their first deck and first quiz; an educator has a class
plus one piece of imported material; a manager has an organization and one invited
teacher. That is the outcome the copy and the checklist steps serve.

### 4.7 Mutation and invalidation ownership

`useSetupFlow()` is the only caller of the writes and the only place that
invalidates:

1. `setType` → account-type endpoint (server refresh) → `AuthProvider.refresh()`
   → recompute state.
2. `acceptInvite` → `POST /invites/accept` (sets `active_org_id`; if the caller
   was untyped it also writes the persona and refreshes the session cookies) →
   invalidate `['orgs']` with `refetchType: 'all'`, permissions, features,
   question reports → resolve from the **response** (org id/role) or
   `getQueryData(['orgs'])`.
3. `createOrg` → `POST /organization` (sets `active_org_id`) → same invalidations
   → same destination rule. The educator body then posts `/invites/bulk` if rows
   were added.

The destination is computed from data, never from `orgs.length` in the closure —
that is the #305/#310 shape. Navigation is `router.replace`, so `/setup` never
stays in history. An untyped session's `/me/orgs` 401 is cached, so the type write
must also invalidate `['orgs']` after the refresh.

Two tabs: the `complete` mode's `409` makes the losing tab re-read state; the
create path has no server idempotency, so two live submits can create two orgs
(today's behaviour). The shell disables in-flight submits; a server key is a
follow-up, not invented here.

### 4.8 Error and empty states

| Surface                         | States                                                                          | Recovery                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| orgs load                       | loading / error / empty                                                         | `error` shows retry and never offers create/join; `empty` is a real empty |
| invite                          | idle / verifying / valid / invalid / expired / seat limit / submitting / failed | reuse today's `invite_invalid` / `org_full` copy; keep the token visible  |
| create                          | idle / submitting / failed / done                                               | keep the org name on failure; disable in flight                           |
| type write                      | submitting / 409 (other tab) / 503 (refresh failed)                             | 409 re-reads state; 503 shows retry + sign-out                            |
| acceptance failed at activation | token + reason                                                                  | `/setup?intent=join&token=…` with the reason and retry                    |

### 4.9 What is deleted, and what moves

| Removed                                                                                       | Replaced by                                                                                              |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `/setup` chooser                                                                              | `/setup` action step                                                                                     |
| `/setup/join`, `/setup/classroom`, `/setup/org`                                               | `/setup` join / create bodies                                                                            |
| `/app/join`                                                                                   | `/setup?intent=join` (org switcher links there)                                                          |
| `SetupHeader` and per-path back rules                                                         | shell header with sign-out and one back rule                                                             |
| `SetupPage`, `Onboarding` and `AppJoinPage` i18n namespaces                                   | one `Setup` namespace                                                                                    |
| breadcrumbs `/setup/join`, `/setup/classroom`, `/app/join`                                    | one `/setup` entry                                                                                       |
| `manage/layout.tsx` redirect to `/setup/org`                                                  | `/setup` (otherwise every manager 404s)                                                                  |
| `robots.ts` entry for `/setup/`                                                               | `/setup`                                                                                                 |
| `/register` account-type `Select`                                                             | removed; the type is chosen in `/setup`                                                                  |
| `ONB-01…08, ONB-10`, `AUT-01/02/15…18`, the route-rule audit test, the ONB/AUT case documents | same cases through `/setup`; ONB-08 loses the type selection; AUT asserts the client redirect, not a 307 |
| `__tests__/e2e/register.spec.ts`, `join-invite.spec.ts`                                       | registration without the type field; invite handoff                                                      |

`/join?token=…` stays for signed-out invitation links. Pre-market rules apply:
routes are deleted, not redirected; every internal link moves in the same release
(steps 7–8). A static test should fail on a source string referencing a removed
route, so the `manage/layout.tsx` class of dead link cannot recur.

### 4.10 The guided portion is one checklist

`getOnboardingSteps({ persona, membership })` returns descriptors (label key,
href, completion predicate). One component renders them on `/app`, `/edu` and
`/manage` (the manager currently has none), replacing both existing checklists.
Completion is derived from existing endpoints; no new table, no new API.

The student and educator lists gain a **"bring your material"** step (import,
PDF, or AI generation), which is the product's wedge and the reason the visitor
arrived. Mechanics-only lists (create deck, invite) teach the UI without reaching
value.

Dismissal stays in `localStorage` for v1 — per browser, not per account, a
recorded limitation. An overlay tour (driver.js/shepherd/joyride) is not adopted:
a dependency, a second step definition set and a new failure mode on every
navigation. If one is wanted, it gets its own ADR.

### 4.11 Instrumentation

One event per transition, through `log()` (Loki), with bounded labels and
`user.id` only in log bodies:

- `setup.started`, `setup.type_selected` (persona), `setup.type_completed`
  (activation), `setup.action_selected` (join/create/skip),
  `setup.join_completed`, `setup.create_completed`,
  `setup.join_failed` / `setup.create_failed` (bounded reason),
  `setup.checklist_completed` / `setup.checklist_dismissed`.
- `setup.abandoned` is derived (started, no completion within 30 minutes), not
  emitted from a browser beacon.
- The register → activation legs are read from existing Tempo spans for
  `/api/v1/auth/register` and `/api/v1/auth/callback`; setup steps are Loki
  events. A durable funnel table or vendor is a separate decision.

These steps run in the browser and `log()` is server-only, so the events are
posted to a thin `POST /api/v1/setup/events`, validated against a closed enum and
logged server-side. That route uses the same session-only guard (the first
`started`/`type_selected` events happen while the account is untyped) and joins
`SESSION_ONLY_API` in the inventory. `setup.started` fires once per setup session;
the invite token is never logged.

These events land with the type-step slice, not slice 10: #1262 requires the
numbers for the whole path, and an unmeasurable flow is not shippable.

### 4.12 Changing the persona later

The surface is the account page (`/app/account`, `/edu/account` or
`/manage/account`), not `/manage/settings` (org-scoped). The change is refused
(`409`) when a paid personal plan exists or a seat is assigned under the current
persona, whose `audience` would stop matching. The profile moves to the new
family's free plan (`base` / `lite` / `solo`); org memberships and roles do not
change. This amends ADR-0015 §3.2's "set at signup" (line 137) to "set during
first-run setup".

### 4.13 Why staff are blocked

An educator or manager is forced into `/setup` while their settled org list is
empty because every staff dashboard query is org-scoped: there is no `/edu` or
`/manage` data surface without an active organization. That is today's behaviour
(`edu/layout.tsx`, `manage/layout.tsx`); this ADR keeps it and gives the action
step a join path and a sign-out. "Explore first" would require org-less staff
dashboards, which is a different feature, not a copy change.

## 5. Alternatives considered

| Alternative                                                             | Why rejected                                                                                                                                                     |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Keep the old routes and add `/onboarding` beside them** (first draft) | Two shells, two guards, four duplicate mutations. (Building the new shell beside the old routes **temporarily** is the migration step in §8, not the end state.) |
| **`/setup` plus step URLs**                                             | Every step route must re-run the same guard and resolver; that is the defect being removed.                                                                      |
| **One route per persona**                                               | Same duplication; persona already selects copy and actions without routes.                                                                                       |
| **Keep the type in `/register`**                                        | The decision #1262 makes: the visitor knows least about the product at that moment.                                                                              |
| **Store `context` (`solo` / `org`) on the account**                     | The setup action falsifies it immediately — creating a classroom creates an organization.                                                                        |
| **A `pending` catalogue plan**                                          | Forces a fake `scope`/`audience` row every plan read and checkout must exclude; `NULL` already composes to zero.                                                 |
| **Contact-gated manager creation**                                      | The catalogue already has a contact-only top plan; a sales gate on org creation would make `/manage` unreachable for self-signups.                               |
| **Overlay tour library in v1**                                          | New dependency and a second step definition set for a list of links.                                                                                             |

## 6. Consequences

**Positive**

- One guard, one resolver, one mutation hook; a new step cannot bypass the gate or
  forget an invalidation.
- `POST /organization` still enforces educator/manager, so the wider `/setup`
  rule grants no authority.
- Managers can join an organization; members can join another via `?intent=join`.
- Four routes, one header, three i18n namespaces and two checklist copies
  disappear; QA is one route with six outcomes.
- Dropping both defaults removes "unanswered account silently becomes a student
  with `base`".

**Negative / trade-offs**

- The end state moves as one surface, but the migration cannot: steps 4–8 keep the
  old subroutes live beside the new shell until the deletion, which is why the
  links PR and the deletion PR are separate.
- `/setup` loses per-step deep links; analytics carry the step.
- The route rule is wider. The safety argument is the API gates and needs tests:
  `/setup` is `requireAuth` only; a student's `POST /organization` is `403`; an
  untyped session on `/app` redirects to `/setup`.
- Nullable columns require every reader to handle "not chosen"; the regenerated
  types and the null-plan test are the guard.
- Two tabs can still create two orgs; no server idempotency key in v1.
- Dismissal stays per browser.
- A class invite cannot create an account; the visitor is sent to sign-in.

## 7. Open questions

1. **Multi-org purchasing UI.** Out of scope: one plan per org or a campus
   contract is a billing surface, not onboarding.
2. **Per-account checklist dismissal.** Deferred; v1 is per browser.
3. **Durable funnel storage.** v1 is Tempo + Loki; a table/vendor is separate.

The first draft attributed three questions to #1262 (routes/roles/flags per
outcome, whether setup blocks, shared tour steps). None appear in the issue. They
are answered here: §4.1 (blocking is persona-specific), §4.6 (route/action matrix)
and §4.10 (shared descriptors).

## 8. Sequencing

Build behind the old routes, then flip, then delete. Two PRs are unavoidable at
steps 7–8 (links/i18n, then deletions plus test rewrites); take
`size:exception` or split links from deletions.

| #   | Slice                                                                                                                                                                                                       | Decision          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 1   | Schema + regenerated `database.ts` + seeds: nullable columns, both defaults dropped, trigger untyped/invalid split                                                                                          | §4.4              |
| 2   | Session-only guard, `SECURITY DEFINER` function, endpoint with server-side refresh, integration 401                                                                                                         | §4.2, §4.3        |
| 3   | `resolveSetupState` + unit matrix (pure, no UI)                                                                                                                                                             | §4.1              |
| 4   | New shell at `/setup` (replaces the chooser; old subroutes stay live until step 8); `useSetupFlow`; widen `/setup` to `requireAuth`, keeping `/setup/org` ahead until step 8; events endpoint + step events | §4.6, §4.7, §4.11 |
| 5   | Invitation `target_account_type`, typing at activation, `/join` handoff, `RegisterSchema` field removed, e2e register/join specs updated                                                                    | §4.5              |
| 6   | Flip: null-aware proxy gate, `/login` `/register` redirect, sign-out in the shell                                                                                                                           | §4.2              |
| 7   | Migrate every link, breadcrumb, robots and i18n namespace; switch the org switcher to `?intent=join`                                                                                                        | §4.9              |
| 8   | Delete the four routes and `SetupHeader`; rewrite ONB/AUT specs and case docs                                                                                                                               | §4.9              |
| 9   | Merge checklists (with the import step and manager descriptors)                                                                                                                                             | §4.10             |
| 10  | Funnel read, settings persona change, docs: #1262 wording, PRODUCT.md `/contact`, ADR-0015 amendment                                                                                                        | §4.11, §4.12      |

## 9. Tests the ADR requires

1. Resolver matrix: every cell of §4.1, plus `isFetching: true, orgsCount: 0` →
   `loading`, and an untyped account with two orgs → `type`.
2. Fail-closed: `app_metadata: {}` → `401` (there is no such test today).
3. Proxy negative: untyped on `/app` → `/setup`, and `/join?token=…` stays
   reachable (not swallowed), written red before the fix.
4. Route rule: `/setup` has `requireAuth` and no `allowedAccountTypes`; a
   student's `POST /organization` is `403`.
5. Null plan: untyped profile → zero entitlements, zero limits, `getMyPlan` 404.
6. Invitation typing: the persona comes from the row; a forged
   `user_metadata.account_type` is ignored; an untyped accept is typed in the
   same write.
7. Invite failure paths: expired, seat limit, class token for a non-member; an
   untyped caller with `intent=join` lands on the join step, not the type step.
8. Seeds: after `db reset`, `profiles.account_type` / `personal_plan_key` have no
   column default and the fixture users are still typed.
9. Deleting guard: no source string references a removed route.
10. QA fixture: a tenant helper can boot an untyped account (`dashboardFor`
    returns `undefined` today, so no existing helper can).
11. Events: the session-only route rejects no session, an unknown event is
    `422`, and no log record contains the invite token.

Each assertion names the production line it kills and is proven with
`bun run mutate`; a filter that matches nothing is `ERROR`, not a pass.

## 10. Evidence

- `packages/server/src/config/routes.config.ts`, `apps/web/src/proxy.ts` — persona
  in the path; the missing-claim coercion.
- `packages/server/src/lib/with-auth.ts` — `401` without a claim.
- `supabase/migrations/20261122150000_plan_scope_audience_solo.sql` — trigger
  fallback, derived plans, `DEFAULT 'student'`.
- `supabase/seeds/00_plans.sql` — the `'base'` default re-applied on reset;
  `supabase/seeds/01_seed.sql` — fixture users typed through `raw_app_meta_data`.
- `packages/server/src/types/database.ts` — non-null `account_type`.
- `apps/web/src/components/providers/AuthProvider.tsx` — `refresh()` calls
  `/auth/me`; the server-side cookie refresh is the missing half.
- `packages/server/src/services/{entitlement.resolver,subscription-plan,seat}.ts`
  — null plan composition, `NOT_FOUND`, seat audience.
- `apps/web/src/app/(frontend)/(setup)/setup/*`, `.../app/join/page.tsx` — the
  four bodies, `SetupHeader`, duplicated invalidations.
- `apps/web/src/app/(frontend)/manage/layout.tsx` — the `/setup/org` redirect.
- `apps/web/src/components/layout/org-switcher.tsx`, `lib/breadcrumbs.ts`,
  `app/robots.ts` — link sites.
- `apps/web/src/components/{app,edu}/onboarding-checklist.tsx` — the two lists.
- `apps/web/src/app/(frontend)/pricing/_components/plan-row.tsx` — `campus` is
  contact-only; org billing is org-scoped.
- `__tests__/unit/proxy/api-auth-inventory.test.ts`, `__tests__/qa/ONB`,
  `__tests__/qa/AUT`, `__tests__/e2e/register.spec.ts` — classification, the 307
  assertions and the registration type selector.
