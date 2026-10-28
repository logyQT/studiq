# ONB-01 — Nauczyciel bez organizacji → /setup

- id: ONB-01
- priority: P2 ważny
- module: ONB – Onboarding, organizacje i zaproszenia
- section: Nauczyciel – konfiguracja klasy
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany test.teacher01@example.com (bez organizacji).

## Steps

1. Po zalogowaniu obserwuj adres.
2. Sprawdź ekran „Witaj w StudiQ”.

## Expected result

- Automatyczne przekierowanie na /setup.
- Widoczne dwie opcje: „Dołącz do istniejącej organizacji” i „Utwórz własną klasę”.
- Próba wejścia na /edu przekierowuje z powrotem na /setup.

## Suite seed — tenant model (reconciled)

The case was generated against the legacy manual seed (`test.teacher01@example.com`,
no organisation). The suite version needs exactly that shape — a signed-in educator
who belongs to **no** organisation — so it uses the `bare` tenant profile instead of
the default `content` one:

- Case tenant (deterministic):
  `tenantKey('qa/cases/ONB-01.md', 'ONB-01', 'qa-shared')` → `ONB-01.md::ONB-01::qa-shared`
- Seed: `bun scripts/qa-tenant.ts ONB-01 --profile bare` against the shared Supabase.
  It creates one educator (`seed-educator-<hash>@dev.local`, password `Seed4Test!`),
  no organisation, no group and no content. The spec reads the account from
  `qa/.tenants/ONB-01.json`; it never creates accounts itself.
- Spec: `qa/tests/ONB/ONB-01.spec.ts`, project `qa/playwright.qa.config.ts`,
  baseURL `http://localhost:3010`.
- Isolation: the tenant owns no org, group, deck, bank or quiz row, and the spec
  only reads (`GET /api/v1/me/orgs`, page navigations). Nothing global or singleton
  is touched, so no other case can observe or invalidate this one.

## Observed during the suite walk (qa-env-1, shared app 3010 / DB 54421)

- Logging in through `/login` with the bare educator ends on `/setup`: the proxy
  sends the authenticated user to `/edu`, whose onboarding guard replaces the URL
  once `['orgs']` settles empty.
- `/setup` shows the `SetupPage` chooser in Polish: `<h1>` „Witaj w StudiQ”,
  description „Skonfiguruj swoją klasę, aby rozpocząć.”, and exactly two option
  buttons — „Dołącz do istniejącej organizacji” („Dołącz do szkoły lub uczelni, do
  której zostałeś zaproszony”) and „Utwórz własną klasę” („Stwórz klasę od
  podstaw”). The setup header has no escape link for a first-run educator.
- Opening `/edu` directly renders the teacher shell briefly and then replaces the
  URL with `/setup` (client-side onboarding redirect); the chooser is usable again.
- Each option opens its page: „Dołącz do istniejącej organizacji” → `/setup/join`
  („Dołącz do organizacji”), „Utwórz własną klasę” → `/setup/classroom`
  („Skonfiguruj swoją klasę”). Both subpages carry the header link „Wróć” back to
  `/setup`.
