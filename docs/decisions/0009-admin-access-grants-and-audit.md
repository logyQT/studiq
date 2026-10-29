# ADR-0009: Org-scoped access grants and an append-only audit trail

## Status

Proposed — not implemented. Extends [ADR-0007](0007-admin-api-auth.md): the signed keyring stays as the
bootstrap/machine-client gate, but it stops being an authorization model for tenant data. The
DB-backed fine-grained token system that ADR-0007 names as its destination is superseded in shape
by this decision: tokens become _grants over an organization_, not a bag of resource scopes.

## Context

`apps/admin` is a separate Next.js app on :4000. Its API routes deliberately skip `withAuth`, run on
the service-role client, and trust `apps/admin/src/proxy.ts` as the only authorization point. Today
that gate is `ADMIN_PEM_KEYS`: an env-resident Ed25519 keyring where each key carries semantic scopes
(`organizations:read`, `users:purge`, …), the verified key id is forwarded as `x-admin-key-id`, and every
allow/deny is logged. That was the right fix for #106 — a leaked key is no longer unlimited admin.

It is still the wrong shape for tenant data, for three reasons:

1. **A scope is global.** `organizations:read` reads _every_ organization. There is no dimension in which to
   say "this key may look at WSK Merito for ticket #412 and nothing else". Any operator who can help
   one customer can read all of them, which is god mode with extra steps.
2. **Nothing binds a request to a justification.** We can say _who_ (key id) and _when_, but not _why
   they had access to that org at that moment_. That is the first question in any incident review.
3. **The panel is unusable where it matters.** The browser cannot sign, so in PEM mode every data
   call from the UI gets a 401 (ADM-SEC-02 records this as a known defect). The only way to operate
   the panel is a signing proxy, which collapses attribution back into "whoever held the key".

The panel's own surfaces make the problem concrete. Feature flags, plans and per-user overrides are
platform data. But `/orgs` and `/orgs/[id]` read a tenant's members, groups and roles, `/users`
reads profiles across tenants, and `users:purge` is an irreversible hard delete. The moment a support
or ops team is formed — human _or agent_ — the first real ticket will be "org X is broken and we
cannot see anything". Without a model for that, the only answer is to widen a query path, and that
widening never gets narrowed again.

Two existing properties shape the design:

- `RequestContext` is already the single authorization input for every service: `traceId`, `userId`,
  `accountType`, `orgRoleId`, `activeOrgId`, `groupIds`, `permissionScopes`. `activeOrgId` is
  resolved from the `org_members` row, not from the cookie, precisely so a client-supplied id can
  never widen scope. That is the pattern to extend, not replace.
- RLS is live on every public table with a tenant floor (`created_by = auth.uid()` or
  `organization_id IN rls_caller_org_ids()`), but `service_role` bypasses it and the admin app uses
  `service_role` for everything. So the RLS floor currently protects PostgREST from ordinary users
  and protects nothing from the admin app.

Scale is ~1000 MAU. The point of this ADR is not throughput — it is to fix the invariants before the
first incident, while the number of routes that must be converted is still countable.

## Decision

### 1. Principals — one table, one audit plane, two custody models

A single `platform_principal` row represents every non-customer actor: humans (support engineers,
ops, the future review team) and agents. Columns: `id`, `kind` (`human` | `agent`), `subject`
(IdP `sub` for humans; credential reference for agents), `display_label`, `created_at`,
`created_by`, `disabled_at`. There is no `is_superuser`, no role column, and no permission column —
authority never lives on the principal, only on grants.

Custody differs, and only custody:

- **Human** — proven by an IdP session (SSO + MFA). No secret material is stored in the database; the
  `subject` is the IdP subject. Sessions are short and revocable at the IdP.
- **Agent** — a short-lived credential minted _per ticket_, bound to one principal and one open
  grant, hashed at rest in `platform_principal_credential` (never recoverable), with a TTL that
  cannot exceed the grant's `expires_at`. An agent credential cannot exist without a grant, and an
  agent principal cannot grant, approve or review anything. Agents are first-class in the audit
  plane — `actor_kind = 'agent'` — because an agent acting on a ticket must be attributable exactly
  like a human, and because "the agent did it" is never an acceptable post-incident answer.

Both kinds authenticate through the same resolver and produce the same `RequestContext` shape. No
service, controller or query may branch on `kind`.

### 2. Grants — narrow, time-boxed, justified, revocable

`access_grant` is the only thing that can widen access. Columns: `id`, `principal_id`, `org_id`
(NOT NULL), `scopes` (array over a closed allowlist — `org.read`, `member.read`, `content.read`,
`billing.read`, `org.write`, `member.write`; no `*`, no prefix matching, empty array rejected),
`reason` (free text, non-empty, the operator's own words), `ticket_ref` (required, format-checked),
`granted_by` (a human principal), `approved_by` (required when any `*.write` scope is present, and
must differ from `granted_by`), `created_at`, `expires_at`, `revoked_at`.

Rules, all enforced in the database rather than in a service method:

- **Default deny.** A request is authorized only by a row where `revoked_at IS NULL`,
  `now() BETWEEN created_at AND expires_at`, the principal is not disabled, and the agent credential
  (if any) is unexpired. No row, no access. There is no fallback and no "platform admin" bypass.
- **Read is 1 hour by default. Write is separate, rarer, shorter** (30 minutes) and requires a second
  approver. A write grant does not imply a read grant on another org.
- **At most one live grant per organization, from any principal.** Creation takes a row lock on
  the organization (`SELECT ... FROM organizations WHERE id = $1 FOR UPDATE`) and then rejects if any
  other live grant exists for that org — including one held by a different principal. The check and
  the insert are therefore serialized: a concurrent normal grant and a break-glass grant cannot both
  land, which is what keeps "one justification per org at a time" true rather than aspirational.
- **One live grant per (principal, org)** (partial unique index on `(principal_id, org_id)` where
  `revoked_at IS NULL`). Because `expires_at` cannot appear in an index predicate (`now()` is not
  immutable), an **expired but unrevoked** row still occupies the slot: regranting is therefore
  `UPDATE ... SET revoked_at = now()` then `INSERT` in **one transaction**, and a cleanup job
  revokes expired rows so the slot never stays blocked. An implementation test asserts that a
  second grant for the same principal and org can be created after the first expires.
- **Append-only.** `scopes`, `org_id`, `expires_at`, `ticket_ref` and the approver fields cannot be
  updated; the only permitted mutation is setting `revoked_at` once. A trigger rejects anything else,
  including `revoked_at` being cleared.
- **The org picker is the grant list.** The panel lists only orgs with a live grant for the current
  principal. It never renders a searchable directory of all organizations to a support principal.

### 3. The enforcement invariant

> A platform principal's authority is exactly `allowedOrgIds`, and every query is filtered by it.
> There is no branch anywhere that reads a tenant row without an org already inside that set.

Resolution happens once, in the request wrapper. A new `withPlatformAuth` (in `packages/server`, next
to `withAuth`, sharing `withRequestInstrumentation`) authenticates the principal, loads live grants,
and builds `RequestContext` with `allowedOrgIds`, `grantByOrg` (org → grant id, needed for audit),
`ticketRef`, and `permissionScopes` derived from the grant scopes for the requested org. The org for
a request comes from the path or body; it is **checked against `allowedOrgIds`, never trusted**. A
cookie or header hint may only select among already-granted orgs — the same "cookie is a hint, the
row is the proof" rule `withAuth` already follows for `org_members`.

Three layers, each required:

1. **`withPlatformAuth`** — builds the context, rejects a request naming an org outside the set, and
   refuses any permission resolution that would produce the `any` scope. `resolveScope` must never
   return `any` for a platform principal: `own` scopes resolve to the operator's own content (which
   is empty), and `organization` means _the granted org only_. There is no code path that produces
   `isAdmin`.
2. **The query builder** — a single helper, `scopedQuery(ctx, table)`, is the only way admin services
   may reach a tenant table. It requires a non-empty `allowedOrgIds`, appends
   `.in('organization_id', ctx.allowedOrgIds)`, and rejects any table that is not on an explicit
   allowlist of org-addressable tables. **The allowlist is the scope boundary**: tables without an
   `organization_id` (`quiz_attempts`, `student_answers`, `user_daily_activity`,
   `flashcard_practice`, `flashcard_review_state`, `flashcard_study_sessions`) are **not** reachable
   through it, and a service that needs them must first define an org-bound join or derive an org
   column, in its own migration. Until that exists, the grant's honest scope is _content tables
   only_; learning analytics are out of scope. This is a stated exclusion, not an oversight — see
   ADR-0010 §6.
   Services receive `orgId` and assert membership in `allowedOrgIds` before building anything; they
   never accept a filter object from a controller. A count, an aggregate, an export and a "does this
   exist" probe all go through the same helper — existence probes return 404 for out-of-grant orgs,
   not 403, so the panel cannot be used as an org-existence oracle.
3. **RLS as backstop, through the same path as ADR-0008.** There is **one** grant-to-tenant
   integration, and it is the membership materialization described in ADR-0008 §3: the grant is
   inserted as a real `org_members` row with the reserved `support` / `support_write` role and an
   `expires_at`. The admin request path therefore stops using `service_role` for tenant reads and
   queries with the user-scoped client, so the existing tenant-floor policies and
   `rls_caller_org_ids()` apply unchanged — no second, claim-based resolver and no parallel
   `platform_principal_id` JWT path. Revocation **deletes the membership row**, so it takes effect
   on the next request rather than at token expiry; expiry-only revocation is safe only when
   `withAuth`, every membership resolver and the RLS membership policy all enforce the `expires_at`
   predicate, and one resolver that forgets it turns an expired grant into permanent access. The
   grant row remains the audit justification. `service_role` is narrowed to migrations, seeds,
   and a named allowlist of provisioning operations that carry no tenant read.

**How a new route is prevented from bypassing this.** Four guards, because one is never enough:

- Route files under `apps/admin/src/app/(backend)/api/v1/**` must call `withPlatformAuth`; the
  existing PEM path is limited to a fixed, reviewed allowlist of platform-level scopes and may not
  be extended to org data.
- `scripts/check-admin-scoping.ts` **must be added** (it does not exist yet) and wired into
  `bun run lint` next to the import-path guard. Its scope is **not just `apps/admin`**: admin routes
  call shared services in `packages/server/src/services/**`, so the guard also fails when a module
  reachable from the admin app imports the service-role client or calls `.from(<tenant table>)`
  without `scopedQuery(`. `OrganizationService.getAll` is the worked example — reachable from the
  panel, lists every organization, and must take the scoped path rather than a global query. The
  guard also fails a route file with no `withPlatformAuth` export wrapper.
- A route-inventory integration test enumerates the route filesystem and, for every route, asserts
  that a principal granted org A receives zero org B rows. A new route is covered the day it is
  added, without anyone remembering to write a test.
- RLS with `FORCE ROW LEVEL SECURITY` on tenant tables for the app roles, so a missed application
  filter still returns nothing.

### 4. Audit streams — one table, three streams, hashes not values

One partitioned table, `platform_audit_event`, with `stream` in (`access`, `mutation`, `security`).
One table means one audit plane: an investigator queries one place, and the review tooling cannot
silently miss a stream.

Every row carries: `id`, `stream`, `occurred_at`, `actor_principal_id`, `actor_kind`, `grant_id`,
`org_id`, `ticket_ref` (snapshotted), `trace_id`, `route`, `method`, `resource_type`, `resource_id`,
`action`, `outcome` (`allow` | `deny` | `error`), `error_code`, `before_hash`, `after_hash`,
`hash_key_id`, `prev_hash`, `row_hash`, `metadata` (jsonb, redacted, schema-validated),
`schema_version`.

- **Access** — one row per authorized read: which org, which resource type and id, which grant.
- **Mutation** — one row per write, with `before_hash` / `after_hash`, the exact grant that permitted
  it, and the ticket.
- **Security** — one row per denial: missing grant, expired or revoked grant, scope miss, org
  mismatch, RLS refusal, break-glass misuse. `grant_id` may be NULL here because the point of the
  row is often that no grant existed; `metadata.deny_reason` carries the enumeration.

**Why hashes and not values.** The audit table outlives the data it describes (2 years for
mutations). Copying raw before/after values into it would create a second, longer-lived, more widely
readable copy of tenant content — exactly the failure mode this ADR exists to prevent. Hashes prove
"this is the value that was there" and "these two rows are the same/different" without disclosure;
the actual values stay in the resource's own history and in backups. Hashes are HMAC-SHA256 keyed by
an audit key in the secret manager, with the key id recorded, so a low-entropy field cannot be
brute-forced back from its digest.

**Why `grant_id` is the load-bearing column for access and mutation rows.** Actor plus timestamp
plus org is not enough: grants overlap, expire and get revoked, and a principal may have had three
grants over the same org in a week. Without the grant id, "why did they have access at 14:32"
requires reconstructing grant history from a table whose rows may have been dropped by retention.
With it, every access and mutation row pins the exact grant — its `reason`, `ticket_ref`, `granted_by`, `approved_by` and `expires_at` —
and blast-radius review becomes a single group-by over `grant_id`: everything that principal touched
under that justification, in that window, for that org.

### 5. Write path

A mutation and its audit row are one transaction, and a mutation without an audit row must be
impossible rather than merely unlikely:

- Every admin write goes through a `SECURITY DEFINER` function. The function validates grant
  liveness itself by selecting the grant row **`FOR SHARE`** (a write grant `FOR UPDATE`), which
  serialises the check against a concurrent revocation under READ COMMITTED: a revoke that commits
  first makes the mutation wait and then fail, and a mutation that commits first is legitimately
  inside the grant's life. It then sets the session context (`principal_id`, `grant_id`, `trace_id`,
  `ticket_ref`), performs the change and inserts the mutation row. The app role has no `INSERT`/`UPDATE`/`DELETE` on tenant
  tables — only `EXECUTE` on these functions — so the function is not a convention, it is the only
  door.
- A **deferred constraint trigger** on tenant tables verifies, at commit, that a
  `platform_audit_event` mutation row exists for this transaction (`txid_current()`) **that matches
  the change itself**: the same `resource_type` and `resource_id` (the row's primary key), the same
  `action` (`insert`/`update`/`delete`) and the same `after_hash`. The function mints a
  `mutation_correlation_id` per row change, sets it in the session context and writes it on the
  audit row, so a multi-row write is validated as a complete set rather than "some row exists" —
  not merely that the session context was set. A future function that
  sets the context and forgets the row still cannot commit: the write fails and the error surfaces
  as a 500 with a trace id.
- If audit insert fails — a missing month partition, a revoked grant, a storage error — the whole
  transaction rolls back. Write availability is deliberately subordinate to audit completeness. At
  this scale the correct trade is "the operator retries" over "a silent write".

Reads are audited asynchronously: one access row **per authorized resource**, enqueued before the
response is sent (same pattern as `trace-queue`), and the drainer writes with an idempotency key of
`event_id` (a UUID minted per resource read), so retries do not duplicate but two rows in one list
response stay distinct — `trace_id + route` would collapse them. This is **at-least-once, not
lossless**: a process death between the enqueue and the drain loses that batch, and the documented
loss window is one drain interval. Tempo is a second, weaker copy for correlation, not a
guarantee. `access_audit_lag_seconds` and a dead-letter count are alertable metrics, and a
queue that is down is a paging condition, not a warning. Denials are written synchronously — they
are small, rare, and are the ones you cannot afford to lose during an attack.

### 6. Immutability, partitions, retention, erasure

- **Append-only.** `INSERT` and `SELECT` only for application roles; `UPDATE`, `DELETE` and `TRUNCATE`
  revoked from every app role including `service_role`. No RLS policy exists for `UPDATE` or
  `DELETE` at all (absence of a policy is denial), and the table is written only by the definer
  functions.
- **Monthly partitions** per stream. A scheduler creates the next three months in advance; a missing
  partition fails writes closed (see §5) and pages. Partitioning is what makes retention a DDL
  operation instead of a delete storm.
- **Weekly anchor.** The chain head, row count and time range for each partition are signed with an
  ops key and exported to WORM object storage (object lock, immutable bucket). The returned object
  version id is recorded in `platform_audit_anchor`. A weekly verification job recomputes each chain
  up to the last anchored head and alarms on any mismatch — so tampering is detectable even by
  someone who can write to the database.
- **Retention.** Access 90 days, mutation 2 years, security 1 year. A partition is dropped only after
  its anchor is confirmed present in WORM. A legal-hold flag on the partition suspends the drop.
- **GDPR.** Audit rows contain **pseudonymised personal data**, not "no personal data": the actor is
  a principal id (never an email or a name), but principal ids, resource ids, ticket references,
  trace ids and timestamps can still link rows to individuals, and `metadata` is schema-validated
  only to exclude free-form PII. The DPIA, retention, access and erasure analysis must cover those
  fields. Erasure therefore
  does not delete audit rows — it redacts the _join_: the `platform_principal` row keeps its id but
  loses `subject` and `display_label` and gains `erased_at`. Every audit row still resolves, still
  proves "some operator had a grant for this org under this ticket", and no longer resolves to a
  person. Deleting the rows instead would destroy the very evidence that access was lawful, which is
  the opposite of what an erasure request is protecting against. The lawful basis and the 2-year
  mutation retention are recorded in the DPIA, not discovered later.

### 7. Customer-visible access log

Organization owners see support access. `/manage/settings/access-log` (gated by `member.manage`,
satisfied through a new `org.audit.read` capability) shows one entry per grant, not per query:
principal class and a support alias, ticket reference, scopes used, first/last access, duration, and
whether any write occurred. It is served from a grouped view over the access and mutation streams —
no resource ids, no titles, no content, and no operator identity beyond the alias. This is the
cheapest possible trust mechanism and it is also a control: an operator knows the customer will see
the session.

### 8. Break-glass

A separate principal kind and a separate credential held in the secret manager — not in
`ADMIN_PEM_KEYS`, not in the database, not reachable by the normal login path. Using it requires an
`incident_id`; it mints a read-only grant for one org with a TTL measured in minutes (≤ 15), pages
the security channel on creation, and tags every resulting audit row. A second human must review the
incident within 24 hours, recorded as `reviewed_by` / `reviewed_at` on the grant; the review queue
surfaces unreviewed break-glass grants and keeps escalating.

Break-glass changes nothing about enforcement: it is a grant like any other, so org binding, the
`scopedQuery` filter and RLS all still apply. It cannot write, cannot be granted to an agent, cannot
be self-reviewed, and cannot be issued while a normal grant for the same org is live — overlapping
justifications are how attribution gets muddy at exactly the wrong moment.

## Consequences

### Positive

- A support engineer or agent looking at org X runs the same org-bound queries a member runs. There
  is no wider code path to leave behind, so the first incident cannot permanently widen the panel.
- Blast radius is a reviewable object: one grant row, one ticket, one org, one expiry, one approver.
- "Why did they have access then?" is a join, not an investigation — every audit row carries the
  grant that authorized it.
- A leaked key is no longer even the right question: keys grant surface, grants grant orgs, and the
  keyring can no longer carry tenant scopes.
- The audit table cannot become a shadow copy of customer data, and the customer can see support
  access without seeing their own data re-exposed through it.
- The panel becomes usable in **OIDC/proxy mode** (ADM-SEC-02's known defect) because the browser
  session comes from the IdP, not from a signature the browser cannot produce. PEM mode is the
  machine plane and stays machine-only.
- Guards are structural — lint, route inventory, RLS — so the invariant survives the next person who
  adds a route in a hurry.

### Negative

- Two auth stacks coexist during the transition. The keyring can outlive this ADR only if it is
  stripped of org-data scopes early; otherwise it is a permanent bypass with better ergonomics.
- `service_role` stops being the default admin client. Provisioning operations that legitimately
  need it must be named in an allowlist, and some existing admin services will need to become RPCs.
- Every admin service query must be converted. A missed one is a leak, which is why the lint guard
  and the route-inventory test are part of the decision rather than follow-up work.
- Audit volume is request-shaped: a support session browsing an org can write thousands of access
  rows, dwarfing mutations. Aggregation keeps the customer view readable, but storage and query cost
  grow with browsing, not with incidents.
- The hash chain serialises writes per partition. Fine at current volume; it becomes a bottleneck if
  mutation traffic ever grows by orders of magnitude, and the fix (more chains) weakens the "one
  chain per stream" property.
- Dropping partitions means point-in-time answers older than the retention window are gone; the
  answer to an old question becomes "the anchor proves it existed, the detail is gone". This must be
  documented for whoever takes the first two-year-old complaint.
- Agent credentials require a minting service, which is a new high-value target. Mitigated by
  requiring the grant to pre-exist and by keeping agent TTL ≤ grant TTL, but it is still a new
  component to secure and to page on.
- Break-glass paging needs an on-call rotation that does not exist at this scale; the initial
  version pages a channel, which is weaker than paging a person and should be upgraded before the
  support team grows.
- Asynchronous read auditing is at-least-once, not exactly-once. A process death between the response
  and the flush loses the row unless Tempo is treated as the second copy — which is a real
  operational dependency, not a theoretical one.
- Pseudonymising rather than deleting the actor on erasure needs a documented lawful basis and a
  DPIA, and it means "delete my data" produces an answer that is defensible but not what the
  requester expects.
