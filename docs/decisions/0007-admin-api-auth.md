# ADR-0007: Admin API auth — signed keyring with per-key scopes

## Status

Accepted. Supersedes the flat `ADMIN_PEM_KEYS` list that shipped with the admin
panel. The DB-backed fine-grained token system remains the recorded destination
(`docs/plans/foundation-agentic-testing.md`).

## Context

The admin app (`apps/admin`, port 4000) has no user session: its API routes skip
`withAuth` and run on the service-role client, so `apps/admin/src/proxy.ts` is the
only authorization point. Before this decision it was one anonymous boolean:

- `ADMIN_PEM_KEYS` was a comma-separated list of bare Ed25519 SPKI keys. Any valid
  key opened every route; the gate could not tell _which_ key signed.
- The signature covered only `METHOD path timestamp`. Query strings
  (`?search=<email>`) and request bodies (`account_type`, plan limits, flag
  rollouts) were unbound, so a captured signature could be replayed with different
  filters or a different body inside the ±5 minute window.
- A single malformed key threw at module load and took down the whole gate.
- Nothing was attributable: no key id, no audit record.

The issue (#106) also noted that the real PEM flow had never been tested — only
the empty-key dev bypass.

## Decision

Harden the existing env gate now (no database, no migration, no UI change):

1. `ADMIN_PEM_KEYS` is a JSON keyring: `[{ id, key, scopes, expiresAt? }]`.
   - `id` is required, unique, and is the audit identity.
   - Per-entry failures are skipped and logged; a rotation survives a typo.
   - An empty value keeps the historical dev bypass (non-production only). A
     **non-empty** value that parses to zero valid entries fails closed in every
     environment.
2. Scopes are semantic per resource, not path prefixes: every admin surface has
   `:read` / `:write` (`:write` implies `:read`) and `users:purge` is separate
   because it is an irreversible hard delete. Unknown scope names grant nothing and
   are reported at boot. There is no wildcard.
3. The signed payload is
   `<METHOD>\n<pathname>\n<canonical-query>\n<timestamp-ms>\n<sha256-hex(body)>`,
   so query and body tampering fails.
4. The proxy maps path + method to a required scope, denies unknown `/api/*`
   paths, returns 403 on a scope miss and 401 for an expired key, forwards the
   verified key id as `x-admin-key-id` (overwriting any inbound value) and writes
   one attributed log record per authenticated request.
5. `scripts/admin-sign.ts` is the repo-owned signer (`gen` / `sign`) and imports
   the payload and scope code from `apps/admin/src/lib/admin-pem.ts`, so the
   signer and the verifier cannot drift.

Status mapping keeps the QA contract: missing/stale/future timestamp or expired key
→ 401 `ERROR_UNAUTHORIZED`; bad signature, scope miss or unknown path → 403
`ERROR_FORBIDDEN`.

## Consequences

### Positive

- A leaked key no longer equals full admin: blast radius is its scope list.
- Query and body substitution no longer verifies.
- One typo cannot brick the ring; the bad entry is named in the boot log.
- Requests and denials are attributable to a key id.
- QA can sign requests from the repo (`bun scripts/admin-sign.ts`), so ADM-SEC-01
  and ADM-SEC-02 no longer depend on an external script.

### Negative

- Breaking env format, by design: an existing comma-separated value must be
  regenerated with `gen`.
- Still env-based: revocation needs an edit + restart, and `expiresAt` only bounds
  the window when set. There is no nonce, so an _identical_ request replays inside
  ±5 minutes.
- Audit is log-only. The admin app has no `instrumentation.ts`, so records land on
  `console`; a durable `admin_audit_log` table is a separate change.
- The browser admin panel still cannot sign, so it remains unusable in PEM mode.
  That is the DB-token system's job (option B), which this ADR does not replace.
