# EDU-ASG-07 — Wyniki kartkówki – lista uczniów

- id: EDU-ASG-07
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Kartkówki (/edu/assignments)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

SC ukończył kartkówkę.

## Prereqs (tenant model)

The case's own tenant, seeded by `bun scripts/qa-tenant.ts EDU-ASG-07 --fresh` (never
the legacy `teacher-classroom@dev.local` / `student-classroom@dev.local` / `pass`
accounts):

- key: `tenantKey('qa/cases/EDU-ASG-07.md', 'EDU-ASG-07#<run suffix>', 'qa-shared')`
- `qa/tests/profiles/EDU-ASG-07.json` declares the default `content` profile: one
  organization (`qa-edu-asg-07-<suffix>`) with the default group `G1`, its manager,
  an `educator` teacher and a `student` — the tenant's „SC”;
- the tenant's `teacher` is an org member, so `assignment.*` resolves to the `own`
  scope: it may create, target, publish and grade **its own** assignments.
  `teacher_assignments` is scoped by `organization_id`, and the results service
  (`GET /api/v1/teacher/assignments/:id/results`) is gated by `created_by`, so the
  list can only contain this tenant's attempts;
- the tenant's `student` is an org member and a `G1` member — the assignment's group
  target, i.e. the „SC” who completes the quiz;
- the spec builds the prerequisite through the product API inside this tenant: one
  true/false question in a bank, an assignment titled „EDU-ASG-07 kartkówka”,
  `PUT …/targets` with `G1`, `POST …/publish`, then the student's
  `POST /api/v1/assignments/:id/start` + `POST /api/v1/quiz/:attemptId` with the
  correct option. Nothing global is written (no admin setting, feature flag, plan,
  platform stat or singleton row) and no other worker's tenant is read.

Every org/user/group id is `tenantId(key, entity)`; each independent run folds a
fresh suffix into the key, so a re-run never sees a previous run's assignment.

## Steps

1. W szczegółach kliknij „Wyniki” / „Zobacz wyniki”.

## Expected result

- Tabela: Uczeń, E-mail, Wynik, Status (Ocenione / Przesłane / W trakcie), Ukończono, Akcje (przycisk „Oceń”).
- Brak ukończeń: „Żaden uczeń nie ukończył jeszcze tej kartkówki”.

## Walk observations (shared app, pl)

- The assignment details page renders both entry points the case names: a „Wyniki”
  button in the header and a „Zobacz wyniki” action under „Akcje”; both link to
  `/edu/assignments/<id>/results`.
- The results page is headed „Wyniki” with the subtitle „Wyniki uczniów i status
  ukończenia”, a „Powrót do kartkówki” link, and one table with exactly the case's
  six columns in order: Uczeń, E-mail, Wynik, Status, Ukończono, Akcje.
- With no attempt yet the table body is the single cell
  „Żaden uczeń nie ukończył jeszcze tej kartkówki” — the case's empty-state copy.
- After the targeted student submits a correct answer the row shows „QA student”
  (the tenant student's profile name), their e-mail, `1/1`, „Przesłane” (completed,
  `graded_at` still null), the completion date formatted for the UI locale
  (`dd.MM.yyyy` in `pl`) and the „Oceń” action.
- „Oceń” opens `/edu/assignments/<id>/results/<studentId>` — the per-student grading
  page headed „Oceń ucznia”, with „Wynik: 1/1”, the question and the student's answer.
- Status vocabulary: „Przesłane” is the state the case's prerequisite creates.
  „Ocenione” needs a graded open answer and „W trakcie” a running attempt, which the
  single „SC ukończył kartkówkę” prerequisite does not provide; the test therefore
  asserts the empty state and the completed row, not extra fixtures.
- The results list is cached per assignment for the session (`useApiQuery`
  `staleTime: Infinity`), so a teacher who opens the screen before the student
  finishes sees the empty state until the page is reloaded. The spec reloads after
  the student submits (a tester would refresh); in-app invalidation after grading is
  the separate #168 regression (`__tests__/e2e/teacher-assignment-grading-results.spec.ts`).
- The behavior matches the case exactly; no defect to report.

## Test

`qa/tests/EDU/EDU-ASG-07.spec.ts` — one spec, one worker:
`bunx playwright test -c qa/playwright.qa.config.ts qa/tests/EDU/EDU-ASG-07.spec.ts --workers=1 --repeat-each=1`
