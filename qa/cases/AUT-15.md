# AUT-15 — Niezalogowany → trasy chronione

- id: AUT-15
- priority: P1 krytyczny
- module: AUT – Uwierzytelnianie i sesja
- section: Ochrona tras – macierz ról
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Otwórz kolejno: /app, /edu, /manage, /setup, /setup/org, /app/flashcards, /edu/assignments, /manage/members.

## Expected result

- Każda trasa przekierowuje na /login?next=<ścieżka>.

## Suite seed — tenant model (reconciled)

The case was written against the legacy manual seed (no account at all — the subject is
the signed-out state). The suite still gives it its own isolated tenant, like every other
case, but never signs in as it:

- Tenant key: `tenantKey('qa/cases/AUT-15.md', 'AUT-15#<run>', 'qa-shared')` — every id
  (organization, default group, users) is an RFC-4122 UUIDv5 derived from that key.
- Seed: `bun scripts/qa-tenant.ts AUT-15 --profile content --fresh` against the shared
  Supabase (`qa/env.json` → `http://localhost:54421`). `content` seeds one organization
  with a manager, an educator and a student; the spec proves the account exists and then
  proves the browser context holds **no** session, which is the case's prerequisite.
- Accounts: the tenant's `tenant.users.*` (`Seed4Test!` from `tenant-seed.ts`, never
  `pass`). None of them is used to log in — a signed-in user is the opposite case
  (AUT-11, AUT-16–AUT-18).
- `--fresh` gives every independent run a new run suffix, so each run owns a brand-new
  tenant while every id stays derived from `qa/.tenants/AUT-15.json`; the spec contains no
  hard-coded UUID.
- Spec: `__tests__/qa/AUT/AUT-15.spec.ts`, project `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`. Profile manifest: `__tests__/qa/profiles/AUT-15.json` (`content`).
- Isolation: the spec is read-only (`GET` only — the eight routes, `/api/v1/auth/me` and
  the public pages). It writes no global admin setting, feature flag, plan, platform stat
  or singleton row, and touches no other worker's tenant.

## Observed during the suite walk (qa-env-2, shared app 3010 / DB 54421)

- Without a session, all eight routes answer `307` with a relative `Location` header
  **before** any document renders (`NextResponse.redirect` in `apps/web/src/proxy.ts`):
  `/login?next=%2Fapp`, `%2Fedu`, `%2Fmanage`, `%2Fsetup`, `%2Fsetup%2Forg`,
  `%2Fapp%2Fflashcards`, `%2Fedu%2Fassignments`, `%2Fmanage%2Fmembers`.
- The browser lands on the login card: „Witaj ponownie”, „Zaloguj się, aby kontynuować
  naukę”, fields „Adres e-mail” / „Hasło” and the „Zaloguj się” button; `?next=` keeps the
  requested path (percent-encoded) and no protected content flashes.
- `/setup` (educator) and `/setup/org` (manager) redirect exactly like the three
  dashboards — the role rule is evaluated only after the authentication rule, so an
  anonymous visitor never reaches the role check.
- Adjacent regression confirmed in the same walk: the public pages `/`, `/pricing`,
  `/features`, `/contact`, `/login` and `/register` answer `200` without a session, so the
  authentication guard is scoped to the protected routes and does not lock anonymous
  visitors out of the product.
