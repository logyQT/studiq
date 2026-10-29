# STU-11 — Przegląd wyniku quizu (review)

- id: STU-11
- priority: P1 krytyczny
- module: STU – Panel studenta (/app)
- section: Quiz „Sprawdź się”
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zakończony quiz.

## Prereqs (tenant model)

The case's own tenant, seeded by `bun scripts/qa-tenant.ts STU-11 --fresh` (never
the legacy manual accounts or `pass`):

- key: `tenantKey('qa/cases/STU-11.md', 'STU-11#<run suffix>', 'qa-shared')`
- `__tests__/qa/profiles/STU-11.json` declares the default `content` profile: one
  organization with the default group `G1`, its manager/teacher, and the student
  the case signs in as;
- the completed quiz is created inside that tenant through the product API by the
  same student: a personal question bank with three questions (two with an
  explanation, one without), a practice attempt generated from that bank only,
  then submitted with one correct and two wrong answers. No global plan, feature
  flag, admin setting or platform stat is read or written.

Every org/user/group id is `tenantId(key, entity)`; each independent run folds a
fresh suffix into the key and gets a brand-new tenant.

## Observed during the suite walk (shared app 3010 / DB 54421, pl)

- `/app/study/quiz` lists the finished attempt under „Ostatnie quizy” with the
  `1/3` badge and a „Przejrzyj” link to
  `/app/study/session/quiz/<attemptId>/review`.
- The review header shows „Wynik: 33%” and „1 z 3 poprawnych”.
- Each question carries the „Poprawnie” / „Niepoprawnie” badge. On a multiple-choice
  question the correct option is green with a check icon and the wrong selection is
  red, struck through and marked with an X icon; on a true/false question the correct
  button is primary with a check and the wrong selection is the destructive (red)
  button with an X.
- „Wyjaśnienie: …” is rendered when the question has one; the question without an
  explanation renders normally and the page shows no error.

## Steps

1. W „Ostatnie quizy” kliknij „Przejrzyj” przy ukończonym quizie.
2. Przejrzyj każde pytanie.

## Expected result

- Strona /app/study/session/quiz/<id>/review pokazuje pytania, wybrane odpowiedzi, poprawne odpowiedzi oraz wyjaśnienia (np. „Chrzest Polski przyjmuje się na rok 966.”).
- Poprawne i niepoprawne odpowiedzi są czytelnie oznaczone.
- Brakujące wyjaśnienie nie powoduje błędu.
