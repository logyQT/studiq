# STU-10 — Quiz – wznowienie niedokończonego

- id: STU-10
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Quiz „Sprawdź się”
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Rozpoczęty quiz (nie zakończony).

## Prereqs (tenant model)

The case's own tenant, seeded by `bun scripts/qa-tenant.ts STU-10 --fresh` (never
the legacy `student1@dev.local` / `pass` account):

- key: `tenantKey('qa/cases/STU-10.md', 'STU-10#<run suffix>', 'qa-shared')`
- `qa/tests/profiles/STU-10.json` declares the default `content` profile: one
  organization on its default `launch` plan (whose member role grants `quiz`),
  the tenant's manager/teacher, and the `student` account the case logs in as;
- the profile seeds the graph only, so the „Rozpoczęty quiz” prerequisite is built
  by the spec inside that same tenant: the student creates its own question bank
  with three multiple-choice questions through `/api/v1/questions` (the
  `question.create` = `own` scope), then generates a 3-question quiz through
  `/app/study/quiz`. No seed content, plan catalogue row, feature flag or other
  tenant is read or written.

Every org/user/group/question id is derived from the tenant (`tenantId(key, …)`
or an id the tenant's own API returns); each independent run folds a fresh suffix
into the key, and nothing global is written.

## Steps

1. Opuść quiz (np. wróć na /app/study/quiz).
2. Sprawdź banner „Quiz w trakcie”.
3. Kliknij „Kontynuuj”.
4. Powtórz i kliknij „Anuluj” przy trwającym quizie.

## Expected result

- Banner „Masz niedokończony quiz. Kontynuuj lub anuluj go.” z przyciskami „Kontynuuj” i „Anuluj”.
- „Kontynuuj” wraca do tego samego quizu z zachowanymi odpowiedziami.
- ZNANE OGRANICZENIE: „Anuluj” pokazuje komunikat „Anulowanie quizów będzie dostępne wkrótce” (funkcja niezaimplementowana) – potwierdź brak awarii.
