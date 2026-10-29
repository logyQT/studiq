# EDU-QZ-01 — Utworzenie quizu

- id: EDU-QZ-01
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Quizy – kreator (/edu/quizzes)
- prereqs: none (self-contained tenant — see Seed)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

TC.

## Seed (QA-suite)

- Tenant: the case's own `content` tenant (`qa/tests/profiles/EDU-QZ-01.json`), seeded with
  `bun scripts/qa-tenant.ts EDU-QZ-01 --fresh` — one fresh run suffix per independent run. All
  ids come from `tenantKey('qa/cases/EDU-QZ-01.md', 'EDU-QZ-01#<run>', 'qa-shared')` +
  `tenantId(key, entity)`.
- Account: the tenant's `users.teacher`
  (`loginAs(page, tenant, 'teacher', { locale: 'pl' })`), with the tenant org as the active org
  (`active_org_id`). The legacy prerequisite account (`teacher-classroom@dev.local`, `pass`) is
  never used.
- Organization: `qa-edu-qz-01-<suffix>` with a manager, an educator and a student, plus the
  default group `G1`. No content is needed: the case starts from the empty quiz list („Brak
  quizów”).
- Quiz name: the case's „Quiz próbny” carries the run suffix („Quiz próbny <suffix>”) so two
  runs on the same tenant never share a card; the spec addresses the quiz by the id the create
  response returns, never by name alone.
- Nothing shared is read or written: no admin setting, feature flag, plan, platform stat or
  singleton row, and no other tenant.

## Observed during the suite walk (shared app 3010 / DB 54421, worker qa-env-4, pl)

- `/edu/quizzes` with no quizzes renders the empty state „Brak quizów” / „Utwórz pierwszy quiz,
  aby wykorzystywać go w wielu kartkówkach” and the header action „Nowy quiz”, which links to
  `/edu/quizzes/new` (a page, not a dialog).
- `/edu/quizzes/new` renders „Nowy quiz”, the fields „Nazwa *” (`#name`,
  placeholder „np. Quiz z rozdziału 5”) and „Opis” (`#description`, „Opcjonalny opis”), plus
  „Anuluj” and „Utwórz quiz”. „Utwórz quiz” starts **disabled**; it becomes enabled as soon as
  the name has a non-whitespace character and goes back to disabled when the name is cleared or
  contains only spaces.
- Submitting a valid name stores the quiz in the active organization (the create request
  `POST /api/v1/teacher/quizzes` → 201) and routes to `/edu/quizzes/<id>/edit`; the editor shows
  „Edytuj quiz”, the breadcrumb „Quizy › <name> › Edytuj quiz”, the name and description
  prefilled, and the empty state „Brak pytań” / „Dodaj pytania do tego quizu”.
- The created quiz appears on `/edu/quizzes` with its description, „0 pytań” and „Ostatnia
  aktualizacja: …”, linking to `/edu/quizzes/<id>`.
- The server rejects a blank name too: `POST /api/v1/teacher/quizzes { "name": "   " }` → 422
  `UNPROCESSABLE_ENTITY` with `VALIDATION_REQUIRED` on `name`, so the disabled button is backed
  by real validation and not only by the UI.
- „Anuluj” returns to `/edu/quizzes` without creating anything.

## Steps

1. Kliknij „Nowy quiz”.
2. Wpisz nazwę „Quiz próbny” i opis; kliknij „Utwórz quiz”.
3. Zostaw nazwę pustą i spróbuj utworzyć.

## Expected result

- Przejście do edytora quizu (/edu/quizzes/<id>/edit).
- Przycisk „Utwórz quiz” nieaktywny przy pustej nazwie.
