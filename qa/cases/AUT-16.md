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

## Kontrakt po ADR-0015 §7.1 i §14.1 (phase 6)

Powyższy oczekiwany rezultat jest historyczny. Od phase 6 obowiązuje:

- **Trasy obszarów (`/edu`, `/edu/assignments`, `/manage`, `/manage/members`) nie
  przekierowują.** Link jest nawigacją, granicą jest API: strona ładuje się
  (`200`, adres pozostaje), a dane panelu są niedostępne — `GET
/api/v1/teacher/assignments` → `403 FORBIDDEN`, `GET /api/v1/organization/members`
  → `200 {"success":true,"data":[]}` albo `403` (D25), `GET /api/v1/stats/teacher`
  → `200` z własnymi (pustymi) statystykami albo `403`. To jest wymóg §14.1 dla
  zakładki: strona ma się **załadować**, a nie przekierować ani zwrócić 404.
- **Trasy onboardingowe pozostają wyjątkiem osobowym** (`/setup` — EDUCATOR,
  `/setup/org` — MANAGER). Odmowa odpowiada `307` z `Location: /dashboard`, a
  neutralny landing podstawia `/app` dla tego studenta.
- Warstwa wizualna (karta „Brak dostępu w tej organizacji” + przełącznik
  organizacji, ukrycie pozycji menu) jest dostarczana razem z bramką obszaru i ma
  osobny przypadek QA; ten scenariusz pinuje załadowanie trasy i granicę API.

## Suite seed — tenant model (reconciled)

The case was written against the legacy manual seed (`student1@dev.local`), but it
needs no seeded content — only a student session and, for the regression paths, the
same tenant's teacher and manager. It therefore runs against the case's own tenant:

- Case tenant (deterministic):
  `tenantKey('qa/cases/AUT-16.md', 'AUT-16#<run>', 'qa-shared')`, with
  `tenantId(key, …)` for the org, group and accounts.
- Seed: `bun scripts/qa-tenant.ts AUT-16 --profile content --fresh` against the
  shared Supabase (`__tests__/qa/profiles/AUT-16.json` declares the `content` profile
  for the CI seeder). The profile gives this tenant an org with a manager, a
  teacher and a student; all three are used, and none of them is shared with
  another case. A **fresh run suffix per independent run** keeps the tenant
  isolated while every id stays deterministic.
- Accounts: `seed-student-<shortHash>@dev.local`,
  `seed-educator-<shortHash>@dev.local` and `seed-manager-<shortHash>@dev.local` /
  `Seed4Test!` from the fixture; no legacy `@dev.local` manual account and no shared
  `pass` password appears in the spec.
- Spec: `__tests__/qa/AUT/AUT-16.spec.ts`, project `__tests__/qa/playwright.qa.config.ts`,
  baseURL `http://localhost:3010`.
- Isolation: the spec only reads (`POST /api/v1/auth/login`, `GET /api/v1/auth/me`,
  `GET /api/v1/teacher/assignments`, `GET /api/v1/organization/members`,
  `GET /api/v1/stats/teacher`) and navigates pages inside its own tenant. It never
  mutates admin settings, feature flags, plans, singletons or another worker's
  tenant, and it needs no seeded deck, question or assignment.

## Observed during the suite walk (qa-env-4, shared app 3010 / DB 54421) — superseded by phase 6

Zlokalizowany poniżej zapis powstał przed phase 6, gdy proxy przekierowywał te
trasy po typie konta. Po zmianie (`qa/…` kontrakt powyżej) trasy obszarów
odpowiadają `200`, a nie `307`; asercje o „braku chromu innej roli” zastąpiła
bramka obszaru w swoim własnym przypadku. Zapis pozostaje jako historia przebiegu.

- All six routes answer the signed-in student with a `307` redirect to `/app`, for
  the document request and for the RSC request the client router sends on a soft
  navigation. The panel HTML is never sent, so there is no frame in which teacher or
  manager content could be painted; the student dashboard is already on screen when
  the navigation settles.
- The panel APIs stay closed to the member:
  `GET /api/v1/teacher/assignments` and `GET /api/v1/organization/members` return
  `403 FORBIDDEN` (the Member role holds no `assignment.read` / roster key), while
  `GET /api/v1/stats/teacher` — a content key the Member role holds at `own` since
  phase 2b-6 — answers `200` with the student's own (empty) stats or `403`, never
  the teacher's aggregates.
- The areas are auth-only, not a blanket block: the tenant's teacher still reaches
  `/edu/assignments` (`200`, teacher sidebar rendered) and its manager still reaches
  `/manage/members` (`200`, the three seeded members listed).
- The default run locale is Polish and page copy differs per role, so the spec
  asserts URLs, redirect hops, redirect targets and its own tenant's data only — no
  translated labels.

## Observation 2026-11-20 — the roster read (D25)

- `GET /api/v1/organization/members` is no longer "403 because the route is
  reserved for teachers/managers". D25 makes the roster a capability read with
  three authorities in the active org — `org.member.manage`, or `group.manage`,
  or `group.invite` — because the catalog has no `org.member.read` and a Teacher
  must not hold `org.member.manage` (D18/FP-04). A plain Member-role student
  holds none of them, so the route answers `200 {"success":true,"data":[]}`:
  the empty list is the deny shape and carries no member row, e-mail or id.
  `403 FORBIDDEN` remains accepted as the documented alternative;
  `GET /api/v1/teacher/assignments` stays `403` (no `assignment.read` on the
  Member role); `GET /api/v1/stats/teacher` may answer `200` with the member's
  own-scoped stats (2b-6) or `403` — either way without teacher data.
  The spec accepts both shapes and asserts the exact empty body; the walk
  recorded above is left as written.
