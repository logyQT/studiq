# EDU-ASG-05 — Cofnięcie publikacji

- id: EDU-ASG-05
- priority: P1 krytyczny
- module: EDU – Panel nauczyciela (/edu)
- section: Kartkówki (/edu/assignments)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Opublikowana kartkówka bez ukończonych prób.

## Steps

1. Kliknij „Cofnij publikację”.
2. Sprawdź widok studenta.

## Expected result

- Status wraca do „Szkic”; student nie widzi kartkówki na liście.
- Dla kartkówki z ukończonymi próbami zanotuj zachowanie (blokada lub zachowanie wyników).

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`teacher-classroom@dev.local` /
`student-classroom@dev.local`, organization „Classroom”, group „Classroom Group”). The suite
version uses the case's own tenant and never the legacy accounts.

- Profile: `content` (`__tests__/qa/profiles/EDU-ASG-05.json`) — one organization, one default
  group `G1`, and one account per account type: `manager` (org `admin`, group `teacher`),
  `teacher` (account type `educator`), `student`.
- Seed: `bun scripts/qa-tenant.ts EDU-ASG-05 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/group/users from
  `tenantKey('qa/cases/EDU-ASG-05.md', 'EDU-ASG-05#<suffix>', 'qa-shared')` +
  `tenantId(key, entity)`. The spec reads the ids through `loadTenant('EDU-ASG-05')`.
- Content (created by the spec through the product API, idempotently): one question bank,
  one multiple-choice question, and one assignment targeted directly at the tenant
  `student`, then published. The student has **no** completed attempt, which is the case's
  prerequisite. On a CI retry against the same tenant the spec reuses the same
  bank/question/assignment and republishes it, so it never depends on a previous run's
  leftover state.
- Not used: the legacy „Classroom Group” targeting path. The tenant student is a direct
  target of the assignment, so the unpublish behavior does not depend on the group
  teacher/member rule.

## Observed on the shared app (walk, 2026-10-29)

- `/edu/assignments` lists the quiz with the green „Opublikowane” badge.
- The detail screen shows „Opublikowane”, the „Wyniki” / „Drukuj” / „Cofnij publikację”
  actions and the question list; „Cofnij publikację” has no confirmation dialog.
- After clicking „Cofnij publikację” the badge becomes the yellow „Szkic”, the button
  disappears, and the draft actions „Edytuj” / „Usuń” appear.
- While published, the student sees the quiz under „Oczekujące (1)” on `/app/assignments`.
  After the unpublish the student list shows the empty state „Brak kartkówek”, the student
  API `/api/v1/assignments` no longer returns it, and the direct student URL
  `/app/assignments/<id>` renders „Nie znaleziono kartkówki” (API 404).
- The second expected-result bullet („Dla kartkówki z ukończonymi próbami zanotuj
  zachowanie”) is a record-only instruction that explicitly accepts either a block or a
  results-preserving behavior, so it is not asserted: the spec encodes only the
  unambiguous prerequisite the case names (published, no completed attempts).
