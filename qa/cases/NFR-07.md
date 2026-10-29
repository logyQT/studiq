# NFR-07 — Konsola przeglądarki i błędy serwera

- id: NFR-07
- priority: P2 ważny
- module: NFR – Wymagania niefunkcjonalne i międzyobszarowe
- section: Wydajność i stabilność
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Podczas całego testowania.

## Steps

1. Miej otwartą konsolę i zakładkę Network w trakcie wykonywania testów.
2. Zbieraj czerwone błędy, ostrzeżenia hydratacji, odpowiedzi 5xx.

## Expected result

- Brak odpowiedzi 5xx przy poprawnym użyciu i brak nieobsłużonych wyjątków; każdy znaleziony błąd zgłoś z numerem testu.

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`student1@dev.local`, `pass`, ...). The
suite version uses the case's own tenant and never the legacy accounts.

- Profile: `content` (`__tests__/qa/profiles/NFR-07.json`) — one organization with a default group
  and one account per account type: `manager`, `teacher`, `student`.
- Seed: `bun scripts/qa-tenant.ts NFR-07 --fresh` — a fresh run suffix per independent run, so
  every run gets its own org/group/users from
  `tenantKey('qa/cases/NFR-07.md', 'NFR-07#<suffix>', 'qa-shared')` + `tenantId(key, entity)`.
  The spec reads the ids and credentials through `loadTenant('NFR-07')`.
- The test signs in as each of the tenant's three accounts in turn (the case runs „podczas
  całego testowania”, i.e. across panels), each in its own browser context.
- Content (created by the spec through the product API, idempotently): one personal deck
  `NFR-07 console smoke` with three flashcards, owned by the student, so the deck list and the
  deck-detail screen load real data. A re-run on the same tenant deletes and recreates only
  that deck.
- Scope of „correct use”: a full-document walk of a representative cross-module journey —
  public landing page and sign-in screen, every student sidebar screen, every educator sidebar
  screen, every manager sidebar screen — plus the user menu (a client-only portal). It is not
  literally „every screen in the manual plan”; it is the smallest journey that renders every
  panel's list/data surface and hydration path.
- Not used: global admin settings, feature flags, plan rows/catalogues, platform stats,
  singleton rows or another tenant. The public landing page is visited without a session, so
  its render does not depend on any seeded row.

## Walk observations (shared app `:3010`, dev build)

- The walk covered 33 full document loads: `/`, `/login`; student `/app`, `/app/flashcards`,
  deck detail, `/app/study/{learn,cram,quiz,live}`, `/app/topics`, `/app/questions`,
  `/app/assignments`, `/app/reports`, `/app/stats/{content,results,activity}`; educator `/edu`,
  `/edu/flashcards`, `/edu/topics`, `/edu/questions`, `/edu/quizzes`, `/edu/assignments`,
  `/edu/reports`, `/edu/stats/{data,results,activity}`; manager `/manage`, `/manage/members`,
  `/manage/invites`, `/manage/groups`, `/manage/reports`, `/manage/roles`, `/manage/seats`,
  `/manage/settings`.
- Every document answered `200`; the API calls each screen fires (auth/me, stats, decks,
  organization members, roles, features/me, subscription plans, question-report counters,
  avatars) all answered `2xx`. No `4xx` and no `5xx` appeared in Network during the journey.
- Console produced no red entries and no React hydration warning on any of those loads
  (including the full-document hydration after each `page.goto`). There were no uncaught
  exceptions (`pageerror`).
- `/app/study/live` is the intentional „Live Study / wkrótce” screen; it renders its heading
  and loads cleanly, so it is included as a normal page.
- The app is served by the shared dev build (turbopack chunks), so React dev-mode diagnostics
  are active during the run; the absence of `console.error` is therefore meaningful, not an
  artifact of a production build.
- Warnings (e.g. Radix' `Missing Description or aria-describedby for DialogContent`) are not
  red errors and are outside this case's acceptance criterion; none appeared on the walked
  journey anyway.
- Authenticated visitors are redirected from `/login` to their panel by account type, so the
  public visit and the API sign-in are separate browser contexts in the spec.
