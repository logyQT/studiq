# AUT-10 — Logowanie – próba przekierowania na zewnętrzny adres (open redirect)

- id: AUT-10
- priority: P2 ważny
- module: AUT – Uwierzytelnianie i sesja
- section: Logowanie
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Otwórz /login?next=https://example.com i zaloguj się.
2. Otwórz /login?next=//example.com i zaloguj się.

## Expected result

- Użytkownik NIE jest przekierowywany na zewnętrzną domenę – trafia na swój panel (lub ścieżkę lokalną).

## Suite seed — tenant model (reconciled)

The case was written against the legacy manual seed, but it uses no seeded
content and no organisation — only an account to sign in with. The suite version
therefore takes the case's own tenant and signs in as its **student**, who owns
nothing but the tenant graph:

- Case tenant (deterministic):
  `tenantKey('qa/cases/AUT-10.md', 'AUT-10#<run>', 'qa-shared')`, with
  `tenantId(key, …)` for the org, group and accounts.
- Seed: `bun scripts/qa-tenant.ts AUT-10 --profile content --fresh` against the
  shared Supabase. `content` gives an org with manager/teacher/student; the spec
  only uses the student. A **fresh run suffix per independent run** keeps the
  tenant isolated, while every id stays deterministic.
- Accounts: `seed-student-<shortHash>@dev.local` / `Seed4Test!` from the fixture;
  no legacy `@dev.local` manual account and no shared password `pass` appears in
  the spec.
- Spec: `__tests__/qa/AUT/AUT-10.spec.ts`, project `qa/playwright.qa.config.ts`,
  baseURL `http://localhost:3010`.
- Isolation: the spec only reads (`POST /api/v1/auth/login`,
  `GET /api/v1/auth/me`) inside its own tenant. It never mutates admin settings,
  feature flags, plans, singletons or another worker's tenant, and it needs no
  seeded deck, question or assignment.

## Observed during the suite walk (qa-env-4, shared app 3010 / DB 54421)

- `/login?next=https://example.com` renders the normal login card; the unsafe
  target is validated on the client (`toSafeInternalPath`) and discarded before
  the form is submitted. After signing in as the tenant student the browser ends
  on `/app` — same origin, no request to `example.com`.
- `/login?next=//example.com` behaves the same: the protocol-relative value
  resolves to another origin and is rejected; the student lands on `/app`.
- The other half of the same validation still works: `/login?next=/app/flashcards`
  signs the student in and lands exactly on `/app/flashcards`.
- For an already signed-in student, opening `/login?next=/app/flashcards` sends
  them to `/app/flashcards`, while `/login?next=//example.com` sends them to
  `/app` — the proxy applies the same rule (`toSafeInternalPath`) as the login
  page.
- `/login` is public, so no session cookie exists before the form is submitted;
  the acceptance point is about the _post-login_ destination only.
