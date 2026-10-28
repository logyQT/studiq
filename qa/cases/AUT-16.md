# AUT-16 — Student → trasy innych ról

- id: AUT-16
- priority: P1 krytyczny
- module: AUT – Uwierzytelnianie i sesja
- section: Ochrona tras – macierz ról
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany student1.

## Steps

1. Otwórz /edu, /edu/assignments, /manage, /manage/members, /setup, /setup/org.

## Expected result

- Każda z tras przekierowuje do /app (panel studenta). Treść paneli nauczyciela/managera nie jest wyświetlana nawet na chwilę.

## Suite seed — tenant model (reconciled)

The case was written against the legacy manual seed (`student1@dev.local`), but it
needs no seeded content — only a student session and, for the regression paths, the
same tenant's teacher and manager. It therefore runs against the case's own tenant:

- Case tenant (deterministic):
  `tenantKey('qa/cases/AUT-16.md', 'AUT-16#<run>', 'qa-shared')`, with
  `tenantId(key, …)` for the org, group and accounts.
- Seed: `bun scripts/qa-tenant.ts AUT-16 --profile content --fresh` against the
  shared Supabase (`qa/tests/profiles/AUT-16.json` declares the `content` profile
  for the CI seeder). The profile gives this tenant an org with a manager, a
  teacher and a student; all three are used, and none of them is shared with
  another case. A **fresh run suffix per independent run** keeps the tenant
  isolated while every id stays deterministic.
- Accounts: `seed-student-<shortHash>@dev.local`,
  `seed-educator-<shortHash>@dev.local` and `seed-manager-<shortHash>@dev.local` /
  `Seed4Test!` from the fixture; no legacy `@dev.local` manual account and no shared
  `pass` password appears in the spec.
- Spec: `qa/tests/AUT/AUT-16.spec.ts`, project `qa/playwright.qa.config.ts`,
  baseURL `http://localhost:3010`.
- Isolation: the spec only reads (`POST /api/v1/auth/login`, `GET /api/v1/auth/me`,
  `GET /api/v1/teacher/assignments`, `GET /api/v1/organization/members`,
  `GET /api/v1/stats/teacher`) and navigates pages inside its own tenant. It never
  mutates admin settings, feature flags, plans, singletons or another worker's
  tenant, and it needs no seeded deck, question or assignment.

## Observed during the suite walk (qa-env-4, shared app 3010 / DB 54421)

- All six routes answer the signed-in student with a `307` redirect to `/app`, for
  the document request and for the RSC request the client router sends on a soft
  navigation. The panel HTML is never sent, so there is no frame in which teacher or
  manager content could be painted; the student dashboard is already on screen when
  the navigation settles.
- The student never sees teacher/manager navigation chrome (no `/edu` or `/manage`
  link appears in the DOM at any point), and the panel APIs stay closed to them:
  `GET /api/v1/teacher/assignments`, `GET /api/v1/organization/members` and
  `GET /api/v1/stats/teacher` all return `403 FORBIDDEN`.
- The gate is role-based, not a blanket block: the tenant's teacher still reaches
  `/edu/assignments` (`200`, teacher sidebar rendered) and its manager still reaches
  `/manage/members` (`200`, the three seeded members listed).
- The default run locale is Polish and page copy differs per role, so the spec
  asserts URLs, redirect hops, redirect targets and its own tenant's data only — no
  translated labels.
