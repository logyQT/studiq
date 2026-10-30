# AUT-17 — Nauczyciel → trasy innych ról

- id: AUT-17
- priority: P1 krytyczny
- module: AUT – Uwierzytelnianie i sesja
- section: Ochrona tras – macierz ról
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany teacher1.

## Steps

1. Otwórz /app, /app/flashcards, /manage, /manage/roles, /setup/org.

## Expected result

- Przekierowanie do /edu. Wyjątek: /setup jest dozwolone dla nauczyciela (sprawdź, co się dzieje, gdy nauczyciel ma już organizację).

## Suite seed — tenant model (reconciled)

The case was generated against the legacy manual seed (`teacher1@dev.local`,
password `pass`, teacher of WSB Merito/UE Wrocław). The suite version uses the
case's own tenant instead, and `content` is exactly the state the case needs: one
organization whose educator has **already onboarded**, which is what the
`/setup` parenthetical asks about.

- Case tenant (deterministic):
  `tenantKey('qa/cases/AUT-17.md', 'AUT-17#<run>', 'qa-shared')`
  → `AUT-17.md::AUT-17#<run>::qa-shared`
- Seed: `bun scripts/qa-tenant.ts AUT-17 --profile content --fresh` against the
  shared Supabase (profile also declared in `__tests__/qa/profiles/AUT-17.json`). It
  creates an organization, its manager/teacher/student and a default group
  (`seed-<role>-<hash>@dev.local`, password `Seed4Test!`), all derived from the
  tenant key through `tenantId`. `--fresh` gives every independent run its own
  suffix, so runs never share an account. The spec reads the tenant from
  `qa/.tenants/AUT-17.json`; it never creates tenant accounts itself.
- The seeded educator is an **org member** of its tenant org (`content` profile),
  not an org-role teacher. That does not change the case: the proxy decides on
  the JWT `account_type` (`educator`), not on the org role, so the route matrix is
  the same one `teacher1` would see.
- Spec: `__tests__/qa/AUT/AUT-17.spec.ts`, run with
  `bunx playwright test -c qa/playwright.qa.config.ts __tests__/qa/AUT/AUT-17.spec.ts --workers=1`,
  baseURL `http://localhost:3010`.
- Isolation: the spec only reads its own tenant (teacher + manager of the same
  tenant, its org list) and writes nothing. No global admin setting, feature flag,
  plan row, platform stat, singleton row or another worker's tenant is touched.

## Observed during the suite walk (qa-env-6, shared app 3010 / DB 54421)

Walked with `AUT-17#rmvsnywibeace` (tenant org `qa-aut-17-rmvsnywibeace`) and
re-confirmed on the wire with the case tenant's educator cookie:

- With an educator session, the proxy answers every route of step 1 with
  `307` + `Location: /edu` **before** the page renders — `/app`,
  `/app/flashcards`, `/manage`, `/manage/roles` and `/setup/org` alike. No
  student or manager panel is ever painted: the browser lands on `/edu`, the
  breadcrumb reads „Panel Nauczyciela”, and the educator sidebar has no
  `/app/study/learn`, `/manage/members` or `/manage/roles` link.
- `/setup` is the stated exception and behaves as the case predicts:
  - the route itself is not blocked for an educator — `GET /setup` is `200`
    (unlike `/setup/org`, which is manager-only and `307`s to `/edu`);
  - because the teacher already belongs to an organization
    (`GET /api/v1/me/orgs` returns exactly the tenant org), the page's gate
    renders its skeleton and then `router.replace`s to `/edu`. The first-run
    chooser („Witaj w StudiQ”) is not shown — with an existing org `/setup`
    effectively resolves to the dashboard.
- Adjacent paths, same surface:
  - the manager direction is symmetric: `/app`, `/app/flashcards` and `/edu` all
    answer `307` + `Location: /manage` for the tenant manager;
  - without a session the same five routes answer
    `307` + `Location: /login?next=<path>` and the browser shows the real login
    form („Witaj ponownie”), i.e. the teacher redirect is an authorization
    decision, not the signed-out fallback.
- Nothing global is involved: the redirect matrix comes from `routeRules`
  (`packages/server/src/config/routes.config.ts`) and the account type in the
  JWT, so plans, feature flags and admin settings cannot flip the result.
