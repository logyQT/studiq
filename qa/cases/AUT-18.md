# AUT-18 — Manager → trasy innych ról

- id: AUT-18
- priority: P1 krytyczny
- module: AUT – Uwierzytelnianie i sesja
- section: Ochrona tras – macierz ról
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany manager@dev.local.

## Steps

1. Otwórz /app, /edu, /edu/assignments, /setup.
2. Otwórz /setup/org.

## Expected result

- Trasy /app, /edu, /setup → przekierowanie do /manage.
- /setup/org jest dozwolone dla managera.

## Suite seed — tenant model (reconciled)

The case was written against the legacy manual seed (`manager@dev.local`, `pass`). The
suite never signs in as a legacy account; it uses the case's own isolated tenant:

- Tenant key: `tenantKey('qa/cases/AUT-18.md', 'AUT-18#<run>', 'qa-shared')` — every id
  (organization, default group, users) is an RFC-4122 UUIDv5 derived from that key.
- Seed: `bun scripts/qa-tenant.ts AUT-18 --profile content --fresh` against the shared
  Supabase (`qa/env.json` → `http://localhost:54421`). The profile is declared once in
  `__tests__/qa/profiles/AUT-18.json`, so the CI seeder (`bun scripts/qa-tenant.ts AUT-18`)
  builds the same tenant. `content` creates one organization with a manager (admin), an
  educator, a student and the default group — the manager is the subject of the case, and
  the educator is the adjacent branch of the `/setup` vs `/setup/org` rule.
- Accounts: `tenant.users.manager` replaces `manager@dev.local`; `tenant.users.teacher` is
  the control for the manager-only `/setup/org`. Both use the seeded password
  `Seed4Test!` from `tenant-seed.ts`, never `pass`.
- `--fresh` gives every independent run a new run suffix, so each run owns a brand-new
  tenant while every id stays derived from `qa/.tenants/AUT-18.json`; the spec contains no
  hard-coded UUID.
- Spec: `__tests__/qa/AUT/AUT-18.spec.ts`, project `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`.
- Isolation: the spec writes nothing — it only opens pages and reads `GET
/api/v1/auth/me`. It never submits the organization form, so no organization, member or
  plan row is created. No global admin setting, feature flag, plan, platform stat or
  singleton row is read or written.

## Observed during the suite walk (qa-env-7, shared app 3010 / DB 54421)

- Signed in as the tenant manager (`app_metadata.account_type = manager`), `GET /app`,
  `GET /edu`, `GET /edu/assignments` and `GET /setup` answer `307` with `Location:
/manage` **before** any document renders (`roleGuard` branch of
  `apps/web/src/proxy.ts`); the browser lands on the manager dashboard
  („Zarządzanie Uczelnią”). `/edu/assignments` is covered by the `/edu(/.*)?` rule, so it
  is part of the same matrix even though the „Expected result” line names only `/edu`.
- `GET /setup/org` answers `200` for the manager and renders the organization form
  („Skonfiguruj swoją organizację”, „Utwórz organizację, aby rozpocząć.”, field „Nazwa
  organizacji”, button „Utwórz organizację”). This is the manager-only rule sitting in
  front of the educator-only `/setup` catch-all; with an inverted order the manager would
  be bounced from `/setup/org` too.
- The rule is not "setup is closed": as the tenant educator, `GET /setup/org` answers
  `307` with `Location: /edu`, while `GET /setup` answers `200`. That pair is the adjacent
  regression the spec pins, so opening `/setup/org` to everybody cannot leave the manager
  assertions green.
- The manager tenant already owns an organization, and `/setup/org` is still served (the
  page has no first-run gate and a manager may own more than one organization, as the
  legacy seed itself does). The case only asks that the route be „dozwolone dla
  managera”, which it is; the spec opens the form and never submits it.
