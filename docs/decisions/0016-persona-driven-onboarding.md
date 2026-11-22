# ADR-0016: Deferred account type and a persona-driven onboarding flow

**Status:** Proposed (draft for review)
**Date:** 2026-11-22
**Related:** [#1262](https://github.com/logyQT/studiq/issues/1262) (tracking), #311, #1192,
[ADR-0015](0015-role-based-authority.md) (persona is not authorization),
[ADR-0007](0007-manager-plan-model.md) (manager plans)
**Verified against:** `c9c14138` on `main` — every "today" claim in §3 was read from
the named file, not inferred from the issue.

---

## 1. Decision summary

1. **The type card is the persona question, and it is onboarding step 1.** Sign-up
   collects name, e-mail and password only. The persona value (`student`,
   `educator` or `manager`) is written by onboarding, then the session is re-minted
   before any typed route is reachable. There is no second "what best fits you?"
   screen.
2. **Untyped is a first-class, gated state, not a null tolerated everywhere.** Until
   the answer, the session may reach `/onboarding` (and sign-out) and one API
   endpoint; every other route redirects there and every other API still answers
   `401`. The gate is server-side, not a client redirect.
3. **The held plan is `personal_plan_key IS NULL`, not a `pending` catalogue row.**
   The resolver already composes "no personal plan" as zero entitlements and zero
   limits; a catalogue row would have to carry a `scope`/`audience` pair and be
   excluded by every reader.
4. **The flow has five reachable first-run outcomes, not six.** "Manager joins an
   organization" is not a context choice; no route accepts an invitation for an
   existing manager account. Joining is the invitation path for every persona, and
   it bypasses the type card because the invitation carries the type.
5. **Context is a one-time action, not a stored mode.** The only persisted
   first-run facts are `account_type` and real membership rows. "Solo" is not an
   attribute: creating a classroom creates an organization, so the action
   immediately falsifies it.
6. **Setup re-uses the shipped route bodies and guards.** `/setup`, `/setup/join`,
   `/setup/classroom` and `/setup/org` stay; the new `/onboarding` shell owns the
   type step and dispatches into them. No parallel setup tree.
7. **Invitations carry `target_account_type`.** `/join?token=…` stops asking, and
   `/register` stops asking, so an invited account never sees the type card. The
   type is written server-side from the invitation, never from the client.
8. **One parameterized checklist replaces the two persona-specific ones.**
   `getOnboardingSteps({ persona, membership })` is a pure client-side function.
   No tour-overlay library is introduced in v1.
9. **Instrumentation ships with the shell.** Step transitions are emitted to the
   existing OTel log pipeline with persona and step, never e-mail or name. A
   funnel claim without those events is not allowed (`PRODUCT.md`).
10. **Changing the type later is allowed only without a paid personal plan.** The
    free plan of the new family is assigned; org memberships and roles do not
    change, because persona is not authority (ADR-0015 §3.2).

## 2. Why the issue forces this shape

[#1262](https://github.com/logyQT/studiq/issues/1262) is not "remove a field": the
account type is the first cell of the authorization model, and five separate
mechanisms assume it exists at minute zero.

- `RegisterSchema` (`packages/server/src/models/auth.model.ts`) requires
  `accountType`; `/join` asks for it too, defaulting to `student`.
- `public.handle_new_user()` (`supabase/migrations/20261122150000_plan_scope_audience_solo.sql`)
  raises when the type is missing and derives `personal_plan_key` from it
  (`base` / `lite` / `solo`).
- `profiles.account_type` is `NOT NULL DEFAULT 'student'`, so "no answer" would
  silently become "student" unless the default is dropped.
- `withAuth()` (`packages/server/src/lib/with-auth.ts`) fails closed: no valid
  `app_metadata.account_type` claim is `401` on every API call.
- `routeRules` (`packages/server/src/config/routes.config.ts`) route by type:
  `/setup` is educator-only, `/setup/org` manager-only, dashboards are
  `/app` | `/edu` | `/manage`.

The onboarding shell therefore cannot be a client-only wizard; it is a new account
state with its own gate, plan state and token transition.

## 3. Verified current state (what the flow builds on)

| Area                                  | Today                                                                                                                                                                                                | Consequence for this ADR                                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Sign-up                               | `/register` shows a three-option `Select`; `/join?token=…` shows the same form with `accountType` defaulted to `student`.                                                                            | Both selectors are removed. An invitation must supply the type or the "skip" acceptance criterion is unimplementable.       |
| Invitations                           | An invitation carries `target_org_role_id` / `target_group_role`; it has **no** account type column.                                                                                                 | Org role (Admin / Teacher / Member) does not map 1:1 to persona, so the type must be added to the invitation.               |
| Educator first run                    | `/setup` chooser: join an organization (`/setup/join`) or create a classroom (`/setup/classroom`). `GET /setup` is educator-only.                                                                    | Keep these bodies; the shell links to them.                                                                                 |
| Classroom creation                    | `/setup/classroom` posts `/api/v1/organization` and the service creates a default group. A "class" **is an organization** with a group.                                                              | "Solo educator" is not a durable mode; the action makes them an org owner.                                                  |
| Manager first run                     | `/setup/org` only; the educator chooser rejects managers.                                                                                                                                            | A manager's first-run choice is "create", not "join".                                                                       |
| Student first run                     | `/app` works with no organization; `/app/join` accepts an invitation code. `/app/*` is student-only.                                                                                                 | Students have a valid baseline without setup, so their join step is deferrable.                                             |
| Invite redemption as an existing user | `/app/join` is student-only, `/setup/join` is educator-only, `/setup/org` is manager-only.                                                                                                           | **No route accepts an invitation for an existing manager account.** Manager-join is not a UI branch to add casually.        |
| Guidance                              | Two separate checklist components (`components/app/onboarding-checklist.tsx`, `components/edu/onboarding-checklist.tsx`), each with its own copy, completion queries and `localStorage` dismiss key. | This is the duplication the ADR removes; it is also why a third per-persona flow is rejected.                               |
| Tour engine                           | None. No tour dependency, no tour route.                                                                                                                                                             | Do not record a `getOnboardingSteps()` "engine" as existing; v1 is a checklist config.                                      |
| API inventory                         | `__tests__/unit/proxy/api-auth-inventory.test.ts` treats any handler without `withAuth()` as public.                                                                                                 | The session-only endpoint needs an explicit third category, or CI forces it into `PUBLIC_API` (wrong: it is authenticated). |
| QA coverage                           | `ONB-01 … ONB-10` cover the five outcomes; there is no manager-join case.                                                                                                                            | A sixth branch would need a route, a case and a seeded tenant before it exists.                                             |

Two claims from the draft do not survive this check and are replaced above:

- **"27 leaf combinations."** A 3×3×3 tree is 27 leaves arithmetically, but the
  third axis in this product is the action, which is chosen by the persona, not
  by the user. No requirement asks for 27 screens; the rejected alternative is
  recorded in §5, not treated as the status quo.
- **"Personal workspace provisioning" for a solo student.** There is no such step
  and no such object. A standalone student simply uses `/app`; their content is
  personal (no org) and needs no provisioning action.

## 4. Decision detail

### 4.1 The state machine

```
authenticated
  ├── account_type IS NULL ──────────► /onboarding/type  (3 cards, blocking)
  └── account_type set
        ├── invitation already accepted ────────────────► dashboard (checklist)
        ├── student, no org ──► join (deferrable) ──────► /app  (checklist: personal)
        ├── student, org member ────────────────────────► /app  (checklist: member)
        ├── educator, no org ──► /setup chooser ────────► classroom | join ──► /edu
        ├── educator, org member ───────────────────────► /edu  (checklist: member)
        ├── educator, org owner ────────────────────────► /edu  (checklist: owner)
        └── manager ────────────► /setup/org ───────────► /manage (checklist: owner)
```

Steps are ordered and resumable because every step's completion is derived from
server state (`account_type`, membership rows), not from a wizard index. A user
who closes the tab after step 1 returns to the next incomplete step.

Persona determines whether the setup step is blocking:

- **student:** not blocking. `/app` is a valid baseline (verified by ONB-05);
  joining a class can be deferred to `/app/join`.
- **educator / manager:** blocking. `/edu` and `/manage` already redirect a
  staff account with zero organizations to their setup route.

### 4.2 The gate

Three independent pieces, all server-side:

1. **Proxy (`apps/web/src/proxy.ts`).** After the session refresh, an
   authenticated session with no `app_metadata.account_type` is allowed only
   `/onboarding` and the sign-out path; everything else redirects to
   `/onboarding`. The `/login` and `/register` `redirectIfAuthenticated*` rules
   gain the untyped case (today a missing type matches no key and the untyped
   session can sit on the login form).
2. **`withAuth()` stays exactly as it is.** It answers `401` without a valid
   claim, which is the property that makes the gate real: every data API is closed
   even if a client bypasses the proxy. No `allowedAccountTypes` special case is
   added.
3. **One endpoint, one guard.**
   `POST /api/v1/onboarding/account-type` uses a new session-only guard (a user,
   no permission check, no `account_type` requirement). It validates the enum and
   calls one `SECURITY DEFINER` function that updates `profiles.account_type`,
   `profiles.personal_plan_key` and `app_metadata.account_type`, so the profile
   row and the JWT claim cannot diverge. It is idempotent: the same value is
   `200`, a different value after the first write is `409`.

Because the handler does not call `withAuth()`, the API inventory test must learn
a `SESSION_ONLY_API` category with two assertions: the route really uses the
session-only guard, and it really rejects an unauthenticated caller. Listing it in
`PUBLIC_API` would be a lie and would exempt it from the guard that matters.

### 4.3 The held plan

While `account_type IS NULL`:

- `profiles.account_type` is nullable and **loses `DEFAULT 'student'`**. The
  default is the dangerous part: a missing answer would otherwise be recorded as a
  real one, with a real dashboard and a real plan.
- `profiles.personal_plan_key` is nullable and loses its default. No `pending`
  plan row is added: `scope` is `NOT NULL` and `personal` requires a non-null
  `audience`, so a held key would force a fake catalogue entry that every plan
  query, checkout rule and public pricing read must exclude. The entitlement
  resolver already treats a missing personal plan as a zero layer
  (`personal_plan_key ?? null`, with a warning), which is exactly "no plan yet".
- `handle_new_user()` inserts `NULL` for both when the type is absent, but keeps
  raising for a type that is present and invalid. "No answer" and "typo" must not
  collapse.
- Checkout and plan reads must answer a domain error, not `500`, for a null plan.

The type answer is one server-side write (`account_type` + the family's free plan

- the claim), followed by `refreshSession()` (or re-login) so the new token exists
  before the client can call a typed route.

### 4.4 The five outcomes

| #   | Persona    | First-run action                   | Existing route     | Post-state                           | Checklist key      |
| --- | ---------- | ---------------------------------- | ------------------ | ------------------------------------ | ------------------ |
| 1   | `student`  | continue without a class (default) | `/app`             | personal content, no org             | `student/personal` |
| 2   | `student`  | accept an invitation               | `/app/join`        | org member (group per invitation)    | `student/member`   |
| 3   | `educator` | create a classroom                 | `/setup/classroom` | org owner with one group             | `educator/owner`   |
| 4   | `educator` | accept an invitation               | `/setup/join`      | org member, role from the invitation | `educator/member`  |
| 5   | `manager`  | create an organization             | `/setup/org`       | org owner                            | `manager/owner`    |

`membership` is derived from rows (`org_members` + role), not stored on the
account. An invited account of any persona skips the table: the invitation
supplies the type and the accept step supplies the membership.

### 4.5 Invitations carry the persona

Add `invitations.target_account_type` (the same enum as `profiles.account_type`,
`NOT NULL`). The inviter picks it with the role, or the form derives a default
from the selected role and lets the inviter change it. The
public preview returns it for display only; the registration service writes it
from the invitation row, so a modified client cannot choose a different type.

This is the decision that makes #1262's "an invited user never sees the type
screen" true. The current token carries only an org/group role, and
`Admin → manager` is wrong for a co-teacher, so a mapping table cannot replace the
column.

### 4.6 The guided portion is a checklist, not a tour

`getOnboardingSteps({ persona, membership })` returns step descriptors (label key,
href, completion predicate key). One component renders them; the two existing
components and their duplicate copy are removed. Completion is derived from the
existing endpoints (orgs, members, groups, stats) — no new table, no new API.

Dismissal stays in `localStorage` for v1. It is per browser, not per account; that
is a known limitation recorded here, not a silent behaviour. Per-account dismissal
needs a column and a product decision and is not in this ADR.

An overlay tour (driver.js / shepherd / joyride) is **not** adopted. It would add a
dependency, a new failure mode on every navigation, and a second set of step
definitions next to the checklist. If a guided overlay is later wanted, that is a
separate ADR with the dependency decision explicit.

### 4.7 Changing the type later

The type is editable from account settings while the account has no paid personal
subscription:

- the profile moves to the new family's free plan (`base` / `lite` / `solo`);
- org memberships and org roles are untouched (persona is not authority);
- with a paid personal plan the request is refused (`409 CONFLICT`) until the
  subscription is cancelled, because a `lite/guide/…` purchase cannot silently
  become a `base/…` purchase.

Cross-audience paid-plan migration is explicitly out of scope.

### 4.8 Instrumentation

One event per transition, through the existing OTel log pipeline (`log()`), with
bounded labels only: `onboarding.started`, `onboarding.type_selected` (persona),
`onboarding.context_selected` (action), `onboarding.setup_completed`,
`onboarding.abandoned` (route left before completion), `onboarding.checklist_*`.
Never e-mail, name or free text.

There is no product-analytics sink today, so the funnel is read from Loki for the
first release; a durable funnel table or provider is a separate decision. The
events ship with the shell — #1262's acceptance requires the numbers to exist for
the whole path, and `PRODUCT.md` forbids unmeasured claims.

## 5. Alternatives considered

| Alternative                                                 | Why rejected                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Full question tree at every level (the "27 leaves")**     | Only the persona is a real persisted choice. The other axes are the action (chosen by persona) and the tour variant (derived). Building 27 screens would multiply copy and QA for combinations no user can select.                                                                                                                                            |
| **Keep the type in `/register`**                            | The decision #1262 makes. The visitor knows least about the product at that moment, and the answer gates plan and dashboard before they have seen anything.                                                                                                                                                                                                   |
| **Store `context` (`solo` / `org`) on the account**         | It is invalidated by the very action it describes: creating a classroom creates an organization, so a "solo" educator becomes an org owner a second later. Membership rows are the truth and already exist.                                                                                                                                                   |
| **Six outcomes, including "manager joins an organization"** | No route today lets an existing manager account redeem an invitation (`/setup` is educator-only, `/setup/org` manager-only, `/app/join` student-only), and ADR-0015/#1262 treat the manager as the org creator, not a peer persona. Adding the branch means a new route rule, a QA case and a seeded tenant — a deliberate follow-up, not a card in a wizard. |
| **A `pending` catalogue plan for untyped accounts**         | `subscription_plans` requires `scope` and a non-null `audience` for personal plans, so the row would appear in catalogue/pricing paths that must all remember to exclude it. `NULL` already resolves to zero entitlements and limits.                                                                                                                         |
| **Separate hard-coded flow per persona**                    | The two existing checklist components are the evidence of the cost: duplicated copy, duplicated completion queries, two dismiss keys.                                                                                                                                                                                                                         |
| **Overlay tour library in v1**                              | New dependency and a second step definition set, for a flow whose value is a short list of links to real screens.                                                                                                                                                                                                                                             |

## 6. Consequences

**Positive**

- One gate, one type write and one plan transition, all testable as server state
  rather than wizard position.
- Five outcomes, each with an existing route and a shipped QA case; the
  manager-join gap is named instead of hidden behind a branch that does nothing.
- The invitation path is complete: type + membership arrive together, so the
  invitee never sees the type card.
- Removing `DEFAULT 'student'` eliminates the class of bug where an unanswered
  account is silently treated as a student with `base` entitlements.
- The checklist merge removes the second persona flow without adding a tour
  dependency.

**Negative / trade-offs**

- The gate is three pieces (proxy, unchanged `withAuth`, session-only guard). Each
  needs its own test, including the negative one: an untyped session must not reach
  any data API.
- Nullable `account_type` and `personal_plan_key` require every reader to handle
  "not chosen". The resolver and plan reads already have branches, but new code
  can forget; the null-plan checkout test is the guard.
- `SESSION_ONLY_API` widens the inventory test's vocabulary. It is smaller than
  pretending the endpoint is public.
- Adding `target_account_type` to invitations is a schema change plus an inviter
  UI choice; the alternative (mapping role → persona) is silently wrong for
  co-teachers.
- Dismissal remains per browser, so a checklist can reappear on a second device.
  Accepted for v1.
- A manager who wants to join an existing organization must be invited; there is
  no code-paste path for them until a separate change adds one.

## 7. Open questions

1. **Manager org creation: self-serve or contact/invite?** #1262 leaves this open.
   This ADR keeps today's self-serve `/setup/org` until the product answers; the
   answer changes the manager card's copy, not the state machine.
2. **Per-account checklist dismissal.** Deferred deliberately; v1 keeps
   `localStorage`. If product needs "dismissed once, everywhere", it is a column
   and a follow-up.
3. **Durable funnel storage.** v1 reads OTel logs. A table or vendor is a separate
   ADR; nothing in this flow depends on which one is chosen.

The draft attributed three questions to #1262 (routes/roles/flags per outcome,
whether setup blocks, and which tour steps are shared). None of them appear in the
issue. They are answered above from the code: the route table is §4.4, blocking is
persona-specific in §4.1, and shared tour steps are checklist descriptors composed
by `getOnboardingSteps` in §4.6.

## 8. Implementation slices (maps onto #1262)

| #   | Slice                                                                                                                                    | Decision   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | Schema: nullable `account_type`/`personal_plan_key`, drop both defaults, trigger writes `NULL` for untyped, keep the invalid-value raise | §4.3       |
| 2   | Session-only guard + `POST /api/v1/onboarding/account-type`, idempotent                                                                  | §4.2       |
| 3   | Proxy: untyped gate + `/login` `/register` redirect                                                                                      | §4.2       |
| 4   | Token re-mint after the write, then route by persona                                                                                     | §4.3       |
| 5   | Invitation `target_account_type`, `/join` and `/register` lose the selector                                                              | §4.5       |
| 6   | `/onboarding` shell (type cards, resume, dispatch to existing setup bodies)                                                              | §4.1, §4.4 |
| 7   | Merge the two checklists behind `getOnboardingSteps`                                                                                     | §4.6       |
| 8   | Events + funnel read                                                                                                                     | §4.8       |
| 9   | Settings change of type with the paid-plan refusal                                                                                       | §4.7       |

## 9. Evidence

- `packages/server/src/models/auth.model.ts` — `RegisterSchema.accountType` required.
- `packages/server/src/lib/with-auth.ts` — `401` when `app_metadata.account_type`
  is missing or invalid.
- `packages/server/src/config/routes.config.ts` — `/setup` educator-only,
  `/setup/org` manager-only, dashboards by type.
- `supabase/migrations/20261122150000_plan_scope_audience_solo.sql` —
  `handle_new_user()` raises on a missing type, derives `base`/`lite`/`solo`;
  `profiles.account_type` `NOT NULL DEFAULT 'student'`.
- `packages/server/src/services/entitlement.resolver.ts` — a null personal plan
  composes as no personal layer (with a warning).
- `apps/web/src/app/(frontend)/(setup)/setup/*` and `.../app/join/page.tsx` — the
  five shipped setup bodies; `setup/classroom` creates an organization and a
  default group.
- `apps/web/src/components/{app,edu}/onboarding-checklist.tsx` — the two
  persona-specific checklists.
- `__tests__/unit/proxy/api-auth-inventory.test.ts` — any handler without
  `withAuth()` is treated as public.
- `__tests__/qa/ONB/ONB-01 … ONB-10` — the five outcomes, and the absence of a
  manager-join case.
