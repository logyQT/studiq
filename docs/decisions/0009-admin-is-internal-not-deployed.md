# ADR-0009: `apps/admin` is internal and not deployed yet

## Status

Accepted (2026-11-06). Interim posture: `apps/admin` stays in the repo, is
**not deployed**, and has **no app-level auth**. Supersedes the earlier admin
API PEM-auth record: the PEM keyring, the `apps/admin/src/proxy.ts` gate and
`scripts/admin-sign.ts` were removed, so that record was deleted and this ADR
now holds the decision (it remains in git history).

This ADR records the gap and the ordered blockers, not a target date.

## Context

`apps/admin` is an internal operations tool, not a product surface. It was
carrying app-level Ed25519 PEM auth (`apps/admin/src/proxy.ts`), an admin
Playwright project/job, admin unit/integration tests in the product gates and 20+
QA cases. That was overhead for a tool used by a handful of operators, and the
PEM gate could not protect UI pages while making the browser panel unusable in
PEM mode. It is removed.

What remains today:

- Admin API routes skip `withAuth` and run on the service-role client.
- There is no signature, token, session, Basic auth or shared secret in the app.
- There is no public admin deployment, and no workflow in this repo publishes
  `apps/admin`.
- QA does not exercise admin; product CI does not gate on admin.
- Manual checks are `lint:admin`, `typecheck:admin`, `build:admin`, `test:admin`.

Building a real app-level gate **now** would mean building it on the current
authority model — `account_type` route gates, `org.manage`, plan-seeded
`org_role_features` and a mixed `FEATURES`/`permissions` catalog — which
[`exp/role-authority`](https://github.com/logyQT/studiq/tree/exp/role-authority)
is replacing from the ground up. The admin app is itself updated inside that
programme (Slice 1 catalog cutover, Slice 2 authority cutover). Any scope
vocabulary or grant model introduced today would be a second model to migrate.

## Decision

1. **Keep `apps/admin`.** Pages, controllers, services and the manual scripts
   (`dev:admin`, `build:admin`, `start:admin`, `lint:admin`, `typecheck:admin`,
   `test:admin`) stay.
2. **Do not deploy it.** It is repo-only and local-only. There is no target
   date. "Not deployed" is the current mitigation, not an assumption that an
   edge gate exists.
3. **No interim app-level auth.** Do not restore PEM, and do not add a new
   shared secret, Basic auth, hand-rolled token, header trust or scope
   vocabulary. The next auth design is the one that lands on top of the role
   authority model ([#1046](https://github.com/logyQT/studiq/issues/1046)), not
   a stopgap.
4. **If it is ever deployed, edge protection is mandatory but not sufficient.**
   Vercel Authentication (All Deployments) / Cloudflare Access plus generated-URL
   protection / VPN must cover UI pages and `/api/*` on every URL, and the
   app-level gate and audit below must exist first.
5. **QA and product CI stay out.** No QA case, prerequisite or agent prompt may
   require the panel. `apps/admin` is excluded from `typecheck:all`, `lint`, the
   e2e matrix and the default unit/integration runs.
6. **Manual checks replace the CI gate.** Run `bun run lint:admin`,
   `bun run typecheck:admin`, `bun run build:admin` and `bun run test:admin`
   before touching the admin app.

## Current gap (accepted risk)

| Surface             | Current state                                             | Risk if reachable                                          | Mitigation today                |
| ------------------- | --------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------- |
| Admin UI pages      | No auth; static/CSR shell                                 | Anyone with the URL sees the panel                         | Not deployed                    |
| `/api/v1/*`         | No `withAuth`; service-role client                        | Full platform read/write, including user purge             | Not deployed                    |
| Attribution / audit | None at the admin boundary                                | No actor, no before/after, no denial record                | Not deployed                    |
| Network exposure    | Repo-only; `dev:admin` / `start:admin` are local commands | Accidental LAN/host exposure if someone runs `start:admin` | Operator discipline; not public |
| Machine/CLI callers | Previously PEM-signed; now no path                        | No safe automation path until a gated API exists           | None — do not automate admin    |

**Explicitly accepted:** if this app is exposed without the gates below, it is a
full compromise of the service-role surface. It must not be exposed "temporarily
to test something".

## Blockers, in order

These are the order of work, because each one defines the vocabulary or contract
the next one builds on. Do not start a later blocker before the earlier one has
landed on `main`.

1. **Role authority rework — `exp/role-authority` (ADR-0008 role-based
   authority).** Tracking issue:
   [#1046](https://github.com/logyQT/studiq/issues/1046).
   This is the foundational blocker. It replaces persona-based route gates,
   `org.manage`, plan-seeded `org_role_features` and the mixed
   `FEATURES`/`permissions` catalog with roles, scopes and separated
   entitlements. It also updates the admin app to the new catalog (Slice 1/2).
   Admin auth, grant scopes and audit must be written against that model, not
   the one being deleted. See
   [`docs/decisions/0008-role-based-authority.md`](https://github.com/logyQT/studiq/blob/exp/role-authority/docs/decisions/0008-role-based-authority.md)
   and
   [`docs/plans/role-authority-rollout.md`](https://github.com/logyQT/studiq/blob/exp/role-authority/docs/plans/role-authority-rollout.md).
2. **Admin auth / grants / audit design, re-derived after blocker 1.** The #946
   proposals are **historical input only** (closed; branch
   `docs/admin-auth-adrs`): they assume the removed PEM/keyring and the
   pre-role-authority model. Re-derive human auth (OIDC through Supabase +
   `platform_admin` + MFA, with the edge proxy as defence in depth), org-scoped
   grants + append-only audit, and the adversarial-review P0 answers on the new
   roles/scopes/entitlements. This defines who the actor is and what a grant
   means; it cannot be finalised before blocker 1.
3. **Content boundary decision (FP-03).** Decide whether content RLS stays a
   tenant floor, gets scoped RLS, or moves to a service-role-only server path
   with explicit authorization filters. The admin panel uses the service role,
   so this decides what an authenticated operator can actually reach.
4. **Audit and attribution live.** Append-only `admin_audit_log` (actor,
   action, target, before/after hash, trace id, denial records) written before
   or in the same transaction as mutations. No admin mutation without it.
5. **Edge protection provisioned and verified.** Vercel Authentication (All
   Deployments) or Cloudflare Access plus generated-URL protection, or a true
   VPN for self-hosting. Verify a UI page and an `/api/*` route challenge when
   signed out, on every URL.
6. **Secret sharing, built on 1–3.** Per-secret or per-org grants with reason,
   ticket, expiry and audit; secret values write-only (Vault/KMS), never
   readable back through the panel; machine consumers get short-lived scoped
   tokens, never a copied long-lived secret. This is the first consumer that
   justifies the admin API.

## Deployment exit criteria

`apps/admin` may be deployed only when **all** are true:

- blocker 1 is merged to `main`;
- the re-derived auth/grant/audit design is accepted and implemented, with
  deny-by-default route guards, MFA and per-route grants;
- the FP-03 boundary is decided and enforced;
- the audit log is append-only and covers reads, mutations and denials;
- the edge gate is provisioned and verified for UI and API on every URL;
- no admin-only route is reachable without a guard, and that is covered by tests;
- secret sharing has per-secret/org grants and machine tokens, not a
  platform-wide "god mode" session.

Until then it remains repo-only/local-only.

## Consequences

### Positive

- No half-built auth on an authority model that is about to be replaced.
- No public service-role surface.
- Product CI and QA stop paying for an internal tool.

### Negative / residual risk

- There is no supported way to operate admin outside a local checkout; until the
  blockers land, operators use SQL/scripts, not the panel.
- The app-level gate and audit are genuinely missing. "Not deployed" is the only
  control; it depends on operators not deploying it.
- Admin changes are checked only by the manual `lint:admin`, `typecheck:admin`,
  `build:admin` and `test:admin` commands.

## What we deliberately did not do

- No replacement auth scheme and no scope vocabulary.
- No deployment, preview deployment or "temporary" public URL.
- No restore of the PEM keyring or `scripts/admin-sign.ts`.
- No admin cases in QA and no admin job in product CI.
