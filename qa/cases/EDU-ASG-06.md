# EDU-ASG-06 — Usunięcie kartkówki

- id: EDU-ASG-06
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Kartkówki (/edu/assignments)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Szkic kartkówki.

## Steps

1. Kliknij „Usuń”.
2. Najpierw anuluj okno potwierdzenia, potem potwierdź.

## Expected result

- Okno „Usunąć tę kartkówkę? Tej operacji nie można cofnąć.”; po potwierdzeniu kartkówka znika z listy; anulowanie nic nie usuwa.

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`teacher-classroom@dev.local`, password
`pass`, organization „Classroom”). The suite version uses the case's own tenant and never the
legacy accounts.

- Profile: `content` (`__tests__/qa/profiles/EDU-ASG-06.json`) — one organization, one default
  group `G1`, and one account per account type: `manager` (org `admin`), `teacher` (account
  type `educator`, org `member` — the „TC” analogue that owns and deletes the assignment),
  `student`.
- Seed: `bun scripts/qa-tenant.ts EDU-ASG-06 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/group/users from
  `tenantKey('qa/cases/EDU-ASG-06.md', 'EDU-ASG-06#<suffix>', 'qa-shared')` +
  `tenantId(key, entity)`. The spec reads the ids through `loadTenant('EDU-ASG-06')`.
- The active organization is required: `POST /api/v1/teacher/assignments` stores
  `organization_id` from the request context, and both the create and delete routes only
  admit account type `educator`, which is exactly the tenant's `teacher`.
- The prerequisite „Szkic kartkówki” is built by the spec through the same API the create
  form calls (`POST /api/v1/teacher/assignments`, title only → `status: 'draft'`), twice:
  the assignment the case deletes plus a control draft, so the test proves that confirming
  the dialog removes exactly the confirmed assignment.
- Isolation: the spec reads/writes no global admin setting, feature flag, plan, platform stat
  or singleton row, and does not touch another tenant. Every assertion follows the ids
  returned by those calls, so a re-run on the same tenant (CI seeds one tenant per spec and
  retries against it) only adds drafts the assertions do not depend on.

## Observed during the suite walk (shared app 3010 / DB 54421, worker qa-env-4, pl)

- `/edu/assignments` renders „Kartkówki”; with no assignments it shows the empty state
  „Brak kartkówek” / „Utwórz swoją pierwszą kartkówkę, aby rozpocząć”.
- A draft created from `/edu/assignments/new` lands on `/edu/assignments/<uuid>`: title as
  `h1`, badge „Szkic”, the actions „Edytuj”, „Usuń” and „Drukuj”. Only a draft shows
  „Usuń” — a published assignment shows „Wyniki” / „Cofnij publikację” instead.
- „Usuń” opens an alert dialog titled „Usunąć tę kartkówkę?” with the description „Tej
  operacji nie można cofnąć.” and the buttons „Anuluj” and „Usuń” — the case's copy matches
  the product verbatim.
- „Anuluj” closes the dialog and leaves the draft untouched: the same detail page stays
  rendered and `GET /api/v1/teacher/assignments/<id>` still answers 200.
- Confirming „Usuń” (the dialog's action) returns to `/edu/assignments`, the deleted draft's
  card disappears from the list, `GET /api/v1/teacher/assignments/<id>` answers
  404 `NOT_FOUND` and `GET /api/v1/teacher/assignments` no longer lists it. Other drafts of
  the same educator are unaffected.
