# EDU-ASG-01 — Utworzenie kartkówki (formularz)

- id: EDU-ASG-01
- priority: P1 krytyczny
- module: EDU – Panel nauczyciela (/edu)
- section: Kartkówki (/edu/assignments)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

TC.

## Steps

1. Kliknij „Nowa kartkówka”.
2. Wpisz tytuł „Kartkówka 1”, opis, termin (za 2 dni), limit czasu 10 min, maks. prób 1, próg zaliczenia 50%, włącz „Losuj pytania” i „Losuj odpowiedzi”, włącz „Pokaż wyniki”.
3. Kliknij „Utwórz kartkówkę”.

## Expected result

- Przycisk „Utwórz kartkówkę” nieaktywny przy pustym tytule.
- Po zapisaniu przejście do szczegółów kartkówki w statusie „Szkic”.
- Wartości ustawień widoczne po wejściu w „Edytuj”.

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`teacher-classroom@dev.local`, password
`pass`, organization „Classroom”). The suite version uses the case's own tenant and never the
legacy accounts.

- Profile: `content` (`qa/tests/profiles/EDU-ASG-01.json`) — one organization, one default
  group `G1`, and one account per account type: `manager` (org `admin`), `teacher` (account
  type `educator`, org `member` — the „TC” analogue that creates the assignment), `student`.
- Seed: `bun scripts/qa-tenant.ts EDU-ASG-01 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/group/users from
  `tenantKey('qa/cases/EDU-ASG-01.md', 'EDU-ASG-01#<suffix>', 'qa-shared')` +
  `tenantId(key, entity)`. The spec reads the ids through `loadTenant('EDU-ASG-01')`.
- The active organization is required: `POST /api/v1/teacher/assignments` stores
  `organization_id` from the request context, and the route only admits account type
  `educator`, which is exactly the tenant's `teacher`.
- The spec creates the assignment through the form (the case's own step) and does not need
  any pre-seeded content: the form's quiz is optional, so a draft assignment can be created
  from an empty organization.
- Isolation: the spec reads/writes no global admin setting, feature flag, plan, platform stat
  or singleton row, and does not touch another tenant. Re-running on the same tenant only
  adds another draft with the same title; every assertion follows the id captured from the
  URL after saving, so duplicates cannot change the result.

## Observed during the suite walk (shared app 3010 / DB 54421, worker qa-env-4, pl)

- `/edu/assignments` renders „Kartkówki” with the „Nowa kartkówka” button; with no
  assignments it also shows the empty state „Brak kartkówek” / „Utwórz swoją pierwszą
  kartkówkę, aby rozpocząć”.
- `/edu/assignments/new` is „Nowa kartkówka” („Utwórz nową kartkówkę dla uczniów”) with the
  cards „Podstawowe informacje” (Tytuł *, Opis), „Czas i limity” (Termin, Limit czasu
  (minuty), Maks. prób, Próg zaliczenia (%)) and „Ustawienia” (Losuj pytania, Losuj
  odpowiedzi, Pokaż wyniki).
- With an empty title the submit button „Utwórz kartkówkę” is disabled; typing a title
  enables it. „Maks. prób” defaults to `1`; „Losuj pytania” and „Losuj odpowiedzi” are
  already on by default, while „Pokaż wyniki” is off — so the case's „włącz” for the two
  shuffle options is satisfied without toggling them off, and only „Pokaż wyniki” is clicked.
- Saving navigates to `/edu/assignments/<uuid>`: the title as `h1`, the badge „Szkic”, the
  description, „0” questions/points and the deadline formatted for `pl` (e.g. `31.10.2026`).
- „Edytuj” (`/edu/assignments/<uuid>/edit`, „Edytuj kartkówkę”) shows every saved value:
  title, description, the exact `datetime-local` deadline, limit `10`, max attempts `1`,
  passing score `50`, and all three switches on.
