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

## Kontrakt po ADR-0015 §7.1 i §14.1 (phase 6)

Powyższy oczekiwany rezultat jest historyczny. Od phase 6 obowiązuje:

- **Trasy obszarów (`/app`, `/app/flashcards`, `/manage`, `/manage/roles`) nie
  przekierowują** — link jest nawigacją, a granicą jest API (§7.1). Nauczyciel
  otwierający `/manage` dostaje stronę (`200`, adres bez zmian); jego odczyty
  decydują, co jest widoczne.
- **`/setup/org` pozostaje trasą managera** i nauczyciel dostaje `307` z
  `Location: /dashboard`; neutralny landing podstawia obszar z uprawnień aktywnej
  organizacji, czyli `/edu`. `/setup` jest trasą edukatora i nadal odpowiada `200`;
  ponieważ nauczyciel ma już organizację, bramka `/setup` odsyła go na landing, a
  ten kończy na `/edu`.
- Karta „brak dostępu” i ukrywanie pozycji menu to warstwa wizualna bramki
  obszaru — osobny przypadek QA; ten scenariusz pinuje załadowanie tras, wyjątek
  `/setup/org` i to, że panel innej roli nie pojawia się po landingu.

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
- The seeded educator carries the **`teacher` org role** in its tenant org
  (`content` profile), which is what the landing reads: since ADR-0015 §7.1 the
  area comes from the active org's permissions (`group.manage` / `group.invite` /
  `group.member.manage` → `/edu`), not from the JWT `account_type`. A `member`-role
  educator would land on `/app`, so the spec's `waitFor: /\/edu$/` also pins the
  seeded role.
- Spec: `__tests__/qa/AUT/AUT-17.spec.ts`, run with
  `bunx playwright test -c __tests__/qa/playwright.qa.config.ts __tests__/qa/AUT/AUT-17.spec.ts --workers=1`,
  baseURL `http://localhost:3010`.
- Isolation: the spec only reads its own tenant (teacher + manager of the same
  tenant, its org list) and writes nothing. No global admin setting, feature flag,
  plan row, platform stat, singleton row or another worker's tenant is touched.

## Observed during the suite walk (qa-env-6, shared app 3010 / DB 54421) — superseded by phase 6

Zapis poniżej powstał przed phase 6 (proxy przekierowywał trasy po typie konta).
Po zmianie trasy obszarów odpowiadają `200`; `307` dotyczy już tylko
`/setup/org`, i to z `Location: /dashboard`. Reszta zapisu (landing na `/edu`,
brak chromu innej roli, ścieżka `/setup`) pozostaje aktualna.

Walked with `AUT-17#rmvsnywibeace` (tenant org `qa-aut-17-rmvsnywibeace`) and
re-confirmed on the wire with the case tenant's educator cookie:

- With an educator session, `/setup/org` answers `307` + `Location: /dashboard`
  and the landing resolves `/edu`; the area routes (`/app`, `/app/flashcards`,
  `/manage`, `/manage/roles`) answer `200` and keep their URL. After the landing
  no student or manager panel is painted: the breadcrumb reads „Panel
  Nauczyciela”, and the educator sidebar has no `/app/study/learn`,
  `/manage/members` or `/manage/roles` link.
- `/setup` is the stated exception and behaves as the case predicts:
  - the route itself is not blocked for an educator — `GET /setup` is `200`
    (unlike `/setup/org`, which is manager-only and `307`s to `/dashboard`);
  - because the teacher already belongs to an organization
    (`GET /api/v1/me/orgs` returns exactly the tenant org), the page's gate
    renders its skeleton and then `router.replace`s to `/dashboard`, which
    resolves `/edu` from the org's permissions. The first-run chooser („Witaj w
    StudiQ”) is not shown — with an existing org `/setup` effectively resolves to
    the dashboard.
- Adjacent paths, same surface:
  - the manager direction is symmetric: `/app`, `/app/flashcards` and `/edu` all
    load for the tenant manager (`200`), whose own dashboard is `/manage`;
  - without a session the same paths answer
    `307` + `Location: /login?next=<path>` and the browser shows the real login
    form („Witaj ponownie”), i.e. the areas stay behind auth and the
    `/setup/org` denial is an authorization decision, not the signed-out
    fallback.
- Nothing global is involved: the area rules come from `routeRules`
  (`packages/server/src/config/routes.config.ts`) and the landing's area from the
  active org's permission map, so plans, feature flags and admin settings cannot
  flip the result.
