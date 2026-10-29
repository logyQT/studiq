# ADR-0008: Admin panel authentication for humans — OIDC, an identity-aware proxy, and org-bound grants

## Status

Proposed. This ADR supersedes the **human-facing** part of [ADR-0007: Admin API auth](0007-admin-api-auth.md). That decision remains in force for machine clients: the Ed25519 keyring, its scope vocabulary, and its signed payload stay exactly as they are. The DB-backed fine-grained token system named as ADR-0007's destination remains the long-term replacement for the keyring, not for this decision.

## Context

### What the panel is today

`apps/admin` is a separate Next.js 16 app on port 4000. Its API routes deliberately skip `withAuth`, its services use the service-role Supabase client (`@admin/lib/supabase/admin-client`), and its only authorization point is `apps/admin/src/proxy.ts`. The panel manages feature flags, subscription plans, plan features and limits, user overrides, organizations, and users (including soft-delete, restore, and hard purge).

The current gate has two properties that are fine for a machine plane and wrong for a human one:

- **Only `/api/*` is gated.** Every UI route passes straight through. `ADM-SEC-02` records the consequence honestly: the page loads, the browser's data calls return 401, and the panel is usable only with an empty keyring or "behind a trusted proxy that signs requests."
- **A valid signature is a machine identity.** It proves possession of a private key, not who is sitting at the keyboard. It carries no person, no MFA, no session, and no per-user revocation. `apps/admin/src/lib/api.ts` already says the browser cannot sign; that is not a bug to work around, it is the shape of the mechanism.

### Why the invariants must change now

The panel is about to be used by a support/ops team, including agents, and the first real ticket will read "org X is broken, we cannot access anything." The pressure in that moment is to hand someone a broad key, a service-role console, or an impersonation button. Each of those destroys attribution and leaves a permanent wider query path behind. At roughly 1000 MAU the volume is small; the point is to fix the access model before the first incident teaches us the wrong habit.

The non-negotiables from the operator:

- The panel is **never** on the public front door. Network and identity gating are expected, not optional.
- **No god mode.** Access to an organization's data is a narrow, time-boxed grant, never a wider query path. A support engineer or an agent looking at org X runs the same queries a member would, with `org_id` bound by the grant.
- Every human and agent is scoped to specific organizations. Minimum blast radius per case.
- The design must work for a ticket that arrives before the tooling is comfortable.

### Constraints of the stack

`withAuth` builds a `RequestContext` from the Supabase user, `app_metadata.account_type`, the active-org cookie, the caller's real `org_members` row, and `org_role_permissions`. `@studiq/authz` scopes are `own | group | organization | any`; `buildQueryFilter` returns `{}` for `any`, which is the god-mode primitive in one line. Organizations, roles, and memberships are ordinary Postgres tables with RLS. Supabase Auth already supports OIDC-style sessions, MFA factors, refresh-token rotation, and global sign-out. ADR-0007 already gives machine clients a scoped, attributable keyring.

### The four real-world patterns

| Pattern                                                                                               | What it actually proves                                                   | Browser fit                                                        | Attribution and revocation                                     | Blast radius if bypassed                      | Role here                                                  |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| **OIDC / SSO at the app**                                                                             | A person authenticated by an identity provider                            | Native: redirects, cookies, MFA                                    | Per user; revoke at the IdP or in Supabase; short-lived tokens | One person's capabilities                     | **Required inner layer**                                   |
| **Identity-aware proxy / off-site authority** (Cloudflare Access, Google IAP, Pomerium, oauth2-proxy) | A person and usually a device passed a gate _before_ the app sees traffic | Native; the browser only sees a cookie or a signed assertion       | Central; kill the proxy session and the app is unreachable     | Unauthenticated traffic never reaches the app | **Required outer layer**                                   |
| **Network isolation** (VPN, Tailscale, bastion)                                                       | A device is on the network                                                | Works, but clunky; shared network identity                         | Weak: usually no per-person MFA, coarse revocation             | The whole network segment                     | Optional hardening for ops devices; never the only control |
| **Pasted API keys / bearer tokens**                                                                   | The holder of a secret                                                    | Poor: XSS-readable storage, no interactive MFA, no per-user logout | Per key; coarse and easy to share                              | Whatever the key's scope allows               | **Machine plane only**                                     |

The recommendation is **2 + 1**: identity-aware proxy in front, OIDC in the app, with 3 as an optional extra for operator laptops and 4 confined to CI, scripts, and agents. Neither 1 nor 2 is sufficient alone. A proxy that trusts a spoofable header is worse than no proxy; an app-only login leaves the panel publicly reachable and lets anyone probe the login surface and the API.

### Why Ed25519 request signing cannot be the browser's login

The current scheme signs `METHOD`, pathname, canonical query, timestamp, and a SHA-256 of the body. That is a good design for a process that holds a private key out of band. It cannot be a browser login:

- **The private key would have to live in the browser.** In `localStorage`, `sessionStorage`, or JavaScript memory, it is readable by any script on the origin. One XSS, one malicious dependency, one compromised analytics snippet, and the key is gone. WebCrypto non-extractable keys reduce export risk but do not stop the page from _using_ the key while it is compromised.
- **The browser does not sign its own traffic.** Navigations, prefetches, React Server Component payloads, downloads, `<img>` requests, and many framework fetches never pass through application JavaScript. A signing layer can only cover the calls the app remembers to wrap, which means the gate and the UI disagree about what is protected.
- **Bodies and streams do not cooperate.** Hashing every request body requires buffering it. Uploads, downloads, and streaming responses become fragile, and correctness depends on every client reimplementing the canonical form exactly.
- **It has no human identity.** There is no user, no MFA, no session lifetime, no logout-everywhere, no "who approved this grant." Revocation is an environment edit plus a restart. An identical request can replay inside the ±5 minute window because there is no nonce.
- **CSRF is not the point.** The key is effectively a bearer secret with extra steps; moving it into a cookie does not make it a session.

The keyring should keep doing what it is good at: **CI, ops scripts, service-to-service calls, and agent runners that can hold a secret outside a browser.** `scripts/admin-sign.ts` remains the repo-owned signer, the verifier and signer still share `apps/admin/src/lib/admin-pem.ts`, scopes still come from the keyring, and `users:purge` stays a separate scope. What changes is that the keyring stops pretending to be the human login.

## Decision

### 1. Two layers at the door

The panel sits behind an **identity-aware proxy** (Cloudflare Access, Google IAP, Pomerium, or oauth2-proxy — pick one per deployment, not four). The proxy terminates the public edge, authenticates the person against the corporate IdP, enforces the staff group, and forwards either a signed JWT assertion or a trusted session to `apps/admin`. The app verifies that assertion against the proxy's published keys and issuer. It never trusts a bare `X-Forwarded-User` header, and it refuses traffic that did not come through the proxy (network policy, mTLS, or a proxy-held shared secret, depending on the provider).

Inside the app, the user also authenticates with **OIDC through Supabase Auth**. That is the same identity system as the product: existing accounts, `app_metadata`, and the `AccountType` model. The proxy answers "may this person reach the panel at all?" The app answers "is this person a platform admin, with MFA, and what are they allowed to do?" Either answer alone is insufficient. The app-level check is **defence in depth, never the only check**.

### 2. Who is a platform admin

A platform admin is a real Supabase user with:

- `app_metadata.platform_admin = true`, used for routing and UI;
- a row in a `platform_admins` table (`user_id`, `role`, `disabled_at`, `session_version`), which is authoritative;
- at least one MFA factor, and a session at `aal2`. `aal1` is not enough to open the panel or call its API.

The claim is a convenience, not the source of truth. Every request re-reads the `platform_admins` row, so disabling someone takes effect on their next request rather than after a token expires. The `platform_admin` flag is only a **door key**: it says "may enter the panel." It grants no tenant data by itself.

`platform_admins.role` is deliberately small: `support` (read-mostly, grant-bound), `ops` (platform configuration), and `admin` (can approve grants and manage other platform admins). There is no super-user role that bypasses the grant model.

### 3. No god mode: org-bound grants

Tenant data is reached through a **grant**, not through the `platform_admin` flag:

- An `access_grant` row (ADR-0009 §2) names the grantee, the organization, the capability level (`support` read-only, or `support_write` for a specific remediation), the reason and ticket reference, the requester, the approver, and `expires_at`. Default lifetime is one hour; the maximum is one working day. There is no "all organizations" grant and no null organization.
- The requester cannot approve their own grant. A duty manager or an automated ticket integration approves. Break-glass exists, but it is a short-lived grant with a named approver and post-hoc review, not a shared key.
- A grant is **materialized as a real `org_members` row** with a reserved system role (`support` or `support_write`), a `kind = 'support'` marker, and `expires_at`. Enforcement is **`withPlatformAuth` + `scopedQuery`** (ADR-0009 §3): the wrapper builds `RequestContext.allowedOrgIds` from live grants, and `scopedQuery` is the only way a service reaches a tenant table, so the org predicate is applied by construction. `resolveScope` never returns `any` for a platform principal. The membership row and RLS are **additional backstops**, not the enforcement path — `buildQueryFilter`'s `any` scope can produce an unrestricted filter, so it is never what bounds a support request. Revocation **deletes the row**; expiry is a second line of defence — a cleanup job plus the membership policy (`expires_at is null or expires_at > now()`) — and it only counts while every resolver enforces that predicate (ADR-0009 §3.3). Grant-backed memberships are **excluded from member and seat counts and from org rosters** (`member_count`, seat maths, `ADM-ORG-02`): they are an access artifact, not a person in the organization.
- Support roles are **system roles** (`is_system = true`, refused by `can_assign_org_role` so nobody can hand one out) with a fixed permission matrix, not editable by organization admins, and seeded with **explicit all-disabled** `org_role_features` rows so the plan-feature fallback cannot silently promote a support role to manager. Their scopes are clamped to `organization` at most. `own` and `group` are meaningless for a grantee with no personal or group relationship to the content; `any` is **never** issued to a human session or an agent. A platform principal that resolves to `any` is a bug, not a permission.
- The admin app stops using the service-role client for tenant data. Human requests use the user-scoped Supabase client (`@studiq/server/lib/supabase/server`) so RLS is the backstop. The service role remains for platform-global tables and maintenance jobs, behind an explicit capability check and an allowlist of routes. It is never the path to "read org X because support asked."
- **No impersonation.** "Log in as the user" is rejected: it destroys attribution and hands over the user's session. A grant gives audited access to the organization's data, not to the person.

An agent that touches tenant data is a principal too, and it is **not** a keyring key. It authenticates with the short-lived grant credential defined in [ADR-0009](0009-admin-access-grants-and-audit.md): a bot identity minted per ticket, bound to one organization, a capability level and an expiry, materialized as the same temporary support membership a human grant uses. The server resolves the same `RequestContext` and the same filters, so `allowedOrgIds` binds the request exactly as it does for a person. The keyring does not carry tenant scopes at all (see §5), so there is no "key that can read org X" to bind.

### 4. Platform-wide configuration is a separate capability

Feature flags, subscription plans, plan features and limits, and user overrides are inherently cross-org. They cannot be grant-bound to an organization, and pretending otherwise would create a fake tenant boundary. They are a separate, explicitly enumerated capability set (`flags:read`/`flags:write`, `plans:*`, `overrides:*`, `users:read`/`users:write`/`users:purge`), held on the `platform_admins` row or in the platform scope grant. These capabilities are never implied by `platform_admin` alone, never wildcarded, and writes require step-up re-authentication plus a reason. `users:purge` stays separate from `users:write`, requires a fresh re-auth, a typed confirmation, and a second approver. The panel may list organizations (name, counts) under a metadata-only capability; opening members, roles, groups, or content requires a grant for that organization.

### 5. Machine clients keep the keyring

`ADMIN_PEM_KEYS` is **not removed**. It continues to guard `/api/v1/*` for CI, scripts, and agents, with the same JSON keyring, the same scope vocabulary, the same ±5 minute timestamp, and the same signed payload from ADR-0007. `scripts/admin-sign.ts` remains the signer. The keyring no longer gates the human browser flow, and the human flow never reads it.

The proxy distinguishes principals explicitly:

- A request with a valid Supabase session cookie is a **human** principal. If a session cookie is present, any signature header is ignored — there is no downgrade path from session to machine auth.
- A request with no session and a valid signature is a **machine** principal.
- A request with neither is **401**. A valid principal without the required capability or grant is **403**.

The eventual DB-token system replaces the keyring for machine clients; when it lands, the keyring becomes bootstrap-only. That is ADR-0007's destination, not this ADR's change.

### 6. Session model

- **Where the token lives.** Supabase SSR cookies only: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `__Host-` prefixed in production. The admin app uses its own storage key and, in production, its own subdomain, so the panel's session is not the product's session and a cookie set on one host cannot be replayed on the other. No JWT or private key in `localStorage`, `sessionStorage`, or JS-readable memory.
- **TTL.** Access token 15 minutes in production (the current `jwt_expiry = 3600` is a development convenience, not a target). Absolute session lifetime 8 hours (`[auth.sessions] timebox`), idle timeout 30 minutes (`inactivity_timeout`). The panel is deliberately shorter-lived than the consumer app.
- **Refresh.** The admin proxy runs the same `updateSession` refresh flow as `apps/web`, with refresh-token rotation already enabled. Rotation failure or reuse detection clears the cookie and returns 401. The refreshed token is never trusted for authorization by itself; the `platform_admins` row and the grant are re-read per request.
- **Re-auth for writes.** Every mutating request requires `aal2` and an `auth_time` within the last five minutes. Flags, plans, plan limits, grant approval, role changes, and user purge require this step-up; purge additionally requires a second approver. An old step-up returns 401 with a `REAUTH_REQUIRED` code; an `aal1` session is a 403 with `MFA_REQUIRED`. **Both codes are planned migration work, not part of any change this record makes**; the implementation PR adds them to `APP_ERRORS`.
- **CSRF.** `SameSite=Lax` is necessary but not sufficient. Every mutating route checks `Origin`/`Host` against the admin origin and requires a double-submit CSRF token; non-JSON content types are rejected; no state-changing GET. The identity proxy must preserve cookies and must not rewrite the origin in a way that defeats the check.
- **Logout everywhere.** Local logout clears the cookie and calls Supabase `signOut({ scope: 'global' })`, revoking all refresh tokens. The `platform_admins.session_version` is incremented so in-flight access tokens stop being accepted on the next request. RP-initiated logout at the identity proxy ends the IdP session too, so re-entry requires the IdP, not just a cached cookie.
- **De-provisioning.** Removing the IdP group stops new logins. Disabling the `platform_admins` row, bumping `session_version`, calling global sign-out, and revoking active grants covers the rest. Because the row is checked per request, the effective window is the next request, with 15 minutes as the hard bound even if a check is accidentally skipped. A departed engineer's grants expire on their own, and are revoked immediately on disable.
- **Cookie theft.** HttpOnly, short access TTL, proxy binding, step-up for writes, and global revocation limit replay. A stolen cookie can read what the person could read; it cannot purge users or approve grants without a fresh MFA challenge.

### 7. Break-glass

An auth-provider outage must not make an active incident unworkable, and the workaround must not become the normal path. There is **one** break-glass model, defined in [ADR-0009 §8](0009-admin-access-grants-and-audit.md): a separate principal kind with a credential in the secret manager, requiring an `incident_id`, minting a read-only grant for **one** organization with a TTL of minutes, paging the security channel and requiring a second human to review within 24 hours. It deliberately does not depend on the IdP, which is what makes it usable during an IdP outage. It is not a keyring key: a pre-provisioned platform key cannot express an organization, so it could only be org-blind — exactly the capability this ADR removes.

### 8. Audit

Every human and machine request records the principal (`user_id` or key id), the route, the decision, the trace id, and the reason. **Access and mutation rows require both a `grant_id` and an organization** — that is what makes "why did they have access" answerable. **Security rows may omit `grant_id`**, because a missing-grant denial is often the event being recorded; for those rows the organization is whatever the request named (nullable when the request did not name one), and `metadata.deny_reason` carries the enumeration. This matches ADR-0009 §4. ADR-0007 noted that the admin app has no `instrumentation.ts`, so its records land on `console`. This decision adds the admin `instrumentation.ts` and writes into the single audit contract defined in [ADR-0009 §4](0009-admin-access-grants-and-audit.md): `platform_audit_event`, with `stream` in (`access`, `mutation`, `security`). The events this ADR requires — grant creation, approval, use, expiry and revocation, plus every panel request — are rows in that table with the fields ADR-0009 defines (principal, `grant_id`, org, route, action, resource, outcome, `trace_id`); there is no separate admin audit log. Grant creation, approval, use, expiry, and revocation are audit events in their own right. Logs and traces correlate through the existing OpenTelemetry pipeline; no user id or trace id becomes a metric label.

### 9. Migration and what happens to ADM-SEC-01/02/03

The migration is staged so each step is independently reversible:

1. Enable Supabase MFA (`[auth.mfa.totp]`, optionally WebAuthn), set the panel's session limits, and add `platform_admins`, `platform_principal`, `platform_principal_credential`, `access_grant`, the support system roles, and the `platform_audit_event` table from ADR-0009.
2. Add the admin login (Supabase Auth on :4000) and an admin `withAuth` variant that produces the same `RequestContext` from a session, the `platform_admins` row, and the grant-bound membership. Keep the keyring for `/api/v1`.
3. Move human tenant queries off the service-role client onto the user-scoped client and the grant membership. This is the step that makes the rest real; without it, authentication is theatre.
4. Put the proxy in front, remove public ingress to :4000, and verify that direct-origin requests without the proxy assertion are refused.
5. Update the QA suite and the case text; keep the machine-plane tests.

The QA contract keeps its meaning, with the credential changed from a signature to a session:

| Case           | Invariant that must survive                                                                   | Before                                                                              | After                                                                                                                                                                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADM-SEC-01** | No credential → 401; wrong/insufficient credential → 403; stale credential → 401; valid → 200 | No signature → 401; bad signature → 403; old timestamp → 401; valid signature → 200 | No session and no signature → 401; valid session without `platform_admin`, or admin without a grant on that org → 403; expired session → 401; expired grant → 403; valid session + grant → 200. The machine variant of the case still signs and still asserts the original 401/403/401/200. |
| **ADM-SEC-02** | The UI is not a way around the API gate                                                       | UI loads; browser data calls return 401                                             | The UI itself requires a session: unauthenticated → redirect/401 at the proxy; authenticated non-admin → 403; admin without a grant → org data denied. The old "UI loads, data 401" observation disappears because the UI is now protected as well. The invariant is stronger, not weaker.  |
| **ADM-SEC-03** | Production fails closed                                                                       | Empty `ADMIN_PEM_KEYS` → 401                                                        | Missing OIDC/proxy configuration, an empty admin allowlist, or an untrusted proxy assertion → deny-all 401. An empty keyring still denies machine requests. There is no "empty means open" path in production.                                                                              |

`ADMIN_PEM_KEYS` is retained for machine clients, documented as such, and left out of the human flow. Its scope vocabulary does not change. The browser panel no longer depends on it, which also retires the ADM-SEC-02 note about the panel being usable "only without keys or behind a proxy that signs requests."

### 10. How the QA suite authenticates

QA seeds **real users**, not a signing side-channel:

- `platform.admin@studiq.test` — `platform_admin = true`, an `ops` platform role, a pre-enrolled TOTP factor, and a `platform_admins` row. The suite completes the real login form and the TOTP challenge once per worker, then reuses the storage state.
- `support.one@studiq.test` — `support` platform role, a grant for organization A only. Used to assert that organization B is 403 and that the org list is filtered by grants.
- `student@studiq.test` — no platform claim. Used to assert 403 on every panel route.
- A fixture grant per seeded organization for the ADM-ORG cases, created through the same approval path (or seeded with an explicit `approved_by`) and expiring with the test window.

The negative matrix is explicit: no cookie → 401; tampered or expired cookie → 401; student cookie → 403; support user on an ungranted org → 403; expired grant → 403; write without a fresh step-up → 401; wrong `Origin` → 403; direct-origin request without the proxy assertion (in proxy mode) → 401.

This is **simpler and more faithful** than signing on the browser's behalf. Signing on the browser's behalf required a key the browser never legitimately has, tested the signer and the gate rather than the session, and could not catch a missing claim check, a broken cookie refresh, an MFA bypass, a CSRF hole, or a grant that widened the query. The seeded-login flow exercises the exact code path production uses: proxy → Supabase session → `platform_admins` → grant membership → RLS. It also removes the external `admin_podpisz_zadanie.mjs` dependency and the "N/D" gap recorded in `qa/README.md`. Machine-plane tests remain as a small, separate set using the deterministic test key already present in `playwright.config.ts`, so ADM-SEC-01's signature assertions stay alive.

The identity-aware proxy itself is infrastructure, not application code. QA exercises the app-level OIDC path end-to-end (with `ADMIN_EDGE_MODE=direct`, documented as the test-only difference) and a separate smoke test asserts that a direct request without the proxy assertion is refused when proxy mode is enforced. That is honest about what the suite can and cannot cover.

## Consequences

### Positive

- The panel is not on the public internet, and a direct-origin request without the proxy assertion is refused.
- Every human action is attributable to a person, a grant, an organization, and a trace. There is no shared god key.
- Tenant access is time-boxed, approved by someone other than the requester, auto-expiring, and audited from request to revocation.
- A support engineer or an agent runs the same queries a member runs, with `org_id` bound by the grant. No new cross-org query path is created for convenience.
- Revocation is a database row or an IdP group change, not an environment edit and a restart.
- MFA, short access tokens, step-up for writes, and global sign-out shrink the blast radius of a stolen cookie or laptop.
- The machine plane keeps the good parts of ADR-0007 and loses the pretense that it was ever a browser login.
- QA becomes more faithful and loses an external signer dependency.
- At 1000 MAU, this is still a small system: Supabase Auth, one proxy, two new tables, and one audit table. No bespoke IAM.

### Negative

- More moving parts: an identity provider, an identity-aware proxy, MFA enrollment, session policy, grant approval, and an audit table.
- Grant approval is real product and process work. Incident response gains friction by design; if the break-glass path is not rehearsed, people will route around the model under pressure.
- An IdP, proxy, or Supabase Auth outage makes the panel unavailable. Fail-closed is correct, but it means a narrow, pre-provisioned break-glass key is operationally necessary, and it must be rotated and reviewed.
- Moving human queries off the service role will expose missing or over-broad RLS policies and force query rewrites. That is the point, but it is effort and may temporarily break admin features until each org-scoped surface is covered.
- The client gains 401/403 handling, a re-auth modal, and CSRF plumbing. Cookie namespacing between :3000 and :4000 in local development needs care because cookies are host-scoped, not port-scoped.
- Two authentication mechanisms coexist during migration. The keyring stays env-based until the DB token system lands, so machine revocation is still an edit plus restart for now.
- QA now needs seeded identities, TOTP generation, and secret management in CI. That is a small dependency, and it is less brittle than maintaining a parallel signing path that the browser never really had.
- The identity-aware proxy is a trust boundary the application cannot fully test. A misconfigured proxy that accepts a spoofable header would silently turn the outer layer into decoration; that risk must be covered by infrastructure tests and a refusal to trust unsigned assertions.
