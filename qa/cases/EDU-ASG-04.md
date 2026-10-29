# EDU-ASG-04 — Publikacja – wybór odbiorców

- id: EDU-ASG-04
- priority: P1 krytyczny
- module: EDU – Panel nauczyciela (/edu)
- section: Kartkówki (/edu/assignments)
- prereqs: none (self-contained tenant — see Seed)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Szkic z pytaniami; TC ma grupę „Classroom Group” z SC.

## Seed (QA-suite)

- Tenant: the case's own `content` tenant (`qa/tests/profiles/EDU-ASG-04.json`),
  seeded with `bun scripts/qa-tenant.ts EDU-ASG-04 --fresh` — one fresh run suffix
  per independent run. All ids come from
  `tenantKey('qa/cases/EDU-ASG-04.md', 'EDU-ASG-04#<run>', 'qa-shared')` +
  `tenantId(key, entity)`.
- Accounts: the tenant's `users.teacher` is the teacher publishing the quiz (the
  legacy `teacher-classroom@dev.local` / `TC`), and `users.student` is the reader
  the case calls `SC` (the legacy `student-classroom@dev.local`). No legacy/manual
  account or `pass` is used.
- Organization: `qa-edu-asg-04-<suffix>` with a manager (admin), the teacher and
  the student, plus the default group `G1` — the tenant-model equivalent of the
  case's „Classroom Group”. The teacher's and the student's active org is the
  tenant org; the student is a member of `G1`.
- Content: the spec creates the case's „szkic z pytaniami” itself — one question
  bank and its questions through `POST /api/v1/questions/banks` +
  `POST /api/v1/questions`, then a draft through `POST /api/v1/teacher/assignments`
  and `POST /api/v1/teacher/assignments/:id/questions`. Nothing shared is read or
  written: no global admin setting, feature flag, plan, platform stat or singleton
  row, and no other tenant.
- UI note (walk on the shared app, Polish UI): the draft's publication panel is a
  card titled „Opublikuj” with the group picker „Wybierz grupy…”, the student
  picker „Szukaj uczniów…”, the „Termin” date field, the hint „Wybierz co najmniej
  jedną grupę lub ucznia, aby opublikować” and the disabled button „Opublikuj”.
  After publication the header badge reads „Opublikowane”, the publication panel
  is replaced by „Cofnij publikację” / „Wyniki”, and the quiz appears for the
  student in `/app/assignments` („OCZEKUJĄCE”).

## Steps

1. W panelu publikacji nie wybieraj żadnych odbiorców i spróbuj kliknąć „Opublikuj”.
2. Wybierz grupę „Classroom Group” lub ucznia (pole „Szukaj uczniów…”).
3. Ustaw termin i kliknij „Opublikuj”.

## Expected result

- Bez odbiorców przycisk nieaktywny i komunikat „Wybierz co najmniej jedną grupę lub ucznia, aby opublikować”.
- Po publikacji status „Opublikowane”; kartkówka widoczna dla SC (STU-34).
