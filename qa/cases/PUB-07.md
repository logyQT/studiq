# PUB-07 — Strona 404 (niezalogowany)

- id: PUB-07
- priority: P2 ważny
- module: PUB – Strony publiczne i nawigacja ogólna
- section: Obsługa błędów i zasoby techniczne
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Otwórz http://localhost:3000/nie-ma-takiej-strony.
2. Kliknij „Wróć do strony głównej”.

## Expected result

- Widoczny komunikat „Nie znaleziono strony” z opisem.
- Link „Sprawdź status systemu” (jeśli widoczny) działa lub zanotuj dokąd prowadzi.
- Przycisk wraca na „/”.

## Suite seed — tenant model (reconciled)

The case was generated against the legacy manual seed, but its prerequisite is
"no session": the 404 page is a public route with no tenant input. The suite
version therefore needs no tenant user, content id or organisation — only the
shared app and a fresh browser context (empty cookie jar).

- Case tenant (deterministic, bookkeeping only):
  `tenantKey('qa/cases/PUB-07.md', 'PUB-07', 'qa-shared')` →
  `PUB-07.md::PUB-07::qa-shared`. Independent runs seed with `--fresh`, so the
  key carries a run suffix (`PUB-07.md::PUB-07#r…::qa-shared`) and a re-run never
  reuses a previous org.
- Seed: `bun scripts/qa-tenant.ts PUB-07 --fresh` against the shared Supabase
  (org `qa-pub-07-<suffix>`, manager/teacher/student, password `Seed4Test!`).
  The spec asserts none of those rows; the tenant exists so the case has a
  deterministic, isolated identity like every other suite test.
- Spec: `__tests__/qa/PUB/PUB-07.spec.ts`, project `qa/playwright.qa.config.ts`,
  baseURL `http://localhost:3010`.
- Isolation: the browser starts from `storageState: { cookies: [], origins: [] }`
  with `NEXT_LOCALE=pl` pinned; no user of the tenant is signed in and nothing
  shared (settings, flags, plans, stats) is written.

## Observed during the suite walk (qa-env-7, shared app 3010 / DB 54421)

- `GET /nie-ma-takiej-strony` answers **404** and renders the Polish root 404
  page: `<html lang="pl">`, document title „StudiQ”, decorative `h1` „404”,
  heading „Nie znaleziono strony” and the description „Przepraszamy, nie możemy
  znaleźć strony, której szukasz. Mogła zostać przeniesiona lub usunięta.”
- Two links, both working: „Wróć do strony głównej” → `/` (the landing page
  re-renders) and „Sprawdź status systemu” → `/status` (heading „Status
  systemu”; the health value comes from the read-only health endpoint and is not
  asserted).
- Deeper unknown paths (`/nie-ma-takiej-strony/podstrona`) answer 404 with the
  same page, so the case does not depend on a single hard-coded URL.
- The root 404 renders outside the `(frontend)` layout, so it carries no header
  or footer. The case only requires the message and both links; the missing
  chrome is noted, not asserted.
- Unknown paths under a protected area (`/app/...`, `/edu/...`, `/manage/...`)
  redirect to `/login` (307) through the route rules — out of scope for this
  unauthenticated 404 case.
