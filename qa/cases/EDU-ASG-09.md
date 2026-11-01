# EDU-ASG-09 — Eksport odpowiedzi

- id: EDU-ASG-09
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Kartkówki (/edu/assignments)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Kartkówka z ukończonymi próbami.

## Steps

1. Kliknij „Eksportuj odpowiedzi”.
2. Otwórz pobrany plik.

## Expected result

- Pobiera się plik (CSV) z odpowiedziami uczniów, poprawnie zakodowany (polskie znaki).
- Zawartość odpowiada danym z widoku wyników.

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`teacher-classroom@dev.local` /
`student-classroom@dev.local`, organization „Classroom”, group „Classroom Group”). The
suite version uses the case's own tenant and never the legacy accounts.

- Profile: `content` (`__tests__/qa/profiles/EDU-ASG-09.json`) — one organization, one default
  group `G1`, and one account per account type: `manager` (org `admin`, group `teacher`),
  `teacher` (account type `educator`, org `member`), `student`.
- Seed: `bun scripts/qa-tenant.ts EDU-ASG-09 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/group/users from
  `tenantKey('qa/cases/EDU-ASG-09.md', 'EDU-ASG-09#<suffix>', 'qa-shared')` +
  `tenantId(key, entity)`. The spec reads the ids through `loadTenant('EDU-ASG-09')`.
- Content (created by the spec through the product API, idempotently): one question bank,
  one multiple-choice question, and one assignment targeted directly at the tenant
  `student`, then published. The student starts and submits the attempt, which is the
  case's prerequisite (a quiz with completed attempts). On a CI retry against the same
  tenant the spec reuses the same bank/question/assignment and the already-completed
  attempt, so it never depends on a previous run's leftover state.
- Not used: the legacy „Classroom Group” targeting path. The tenant student is a direct
  target of the assignment, so the export does not depend on the group teacher/member
  rule.

## Observed on the shared app (walk, 2026-10-29)

- `/edu/assignments` lists the quiz with the green „Opublikowane” badge; the detail screen
  `/edu/assignments/<id>` shows the question list and the „Akcje” card with „Drukuj pusty
  test”, „Zobacz wyniki” and „Eksportuj odpowiedzi”. The export button only appears when
  the quiz has at least one question.
- The results screen `/edu/assignments/<id>/results` („Wyniki” / „Wyniki uczniów i status
  ukończenia”) has the columns „Uczeń”, „E-mail”, „Wynik”, „Status”, „Ukończono” and one
  row per attempt; a submitted ungraded attempt shows „Przesłane” and the date in the
  browser locale (e.g. `29.10.2026`).
- Clicking „Eksportuj odpowiedzi” downloads `assignment-<id>-answers.csv` and keeps the
  teacher on the detail page. The response is `text/csv; charset=utf-8` with
  `Content-Disposition: attachment` and `Cache-Control: private, no-store`.
- The downloaded file starts with a UTF-8 BOM (`EF BB BF`), so the Polish header
  „Uczeń,E-mail,Wynik,Status,Ukończono” and the status „Przesłane” decode correctly. The
  single data row is the student from the results view: `QA student, <e-mail>, 1/1,
Przesłane, 29.10.2026` — same name, e-mail, score, status and completion date as the
  table. The detail screen forwards the browser timezone (`?tz=`), which keeps the CSV
  date identical to the view.
- Scope note: the export is the results summary (one row per attempt), i.e. exactly the
  data the „Wyniki” view shows; it does not contain per-question answer text. The case's
  acceptance bullet „Zawartość odpowiada danym z widoku wyników” is the criterion the spec
  encodes.
- Security check (adjacent): the export endpoint is teacher/manager-only — a student
  request for the same assignment's export answers 403 `FORBIDDEN`, so class PII is not
  exposed through the student session.
