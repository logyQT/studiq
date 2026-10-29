# EDU-Q-04 — Pytanie otwarte

- id: EDU-Q-04
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Banki pytań i pytania (/edu/questions)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Bank „Fizyka”.

## Steps

1. Utwórz pytanie typu „Otwarta odpowiedź” z wyjaśnieniem wzorcowej odpowiedzi.

## Expected result

- Brak listy odpowiedzi; pytanie zapisane z typem „Otwarte”.
- Podczas kartkówki student wpisuje tekst, a nauczyciel ocenia ręcznie (EDU-ASG-…).

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`teacher1@dev.local`, password
`pass`, bank „Fizyka” from the manual dataset). The suite version uses the case's own
tenant and never the legacy accounts.

- Profile: `content` (`qa/tests/profiles/EDU-Q-04.json`) — one organization, one default
  group `G1`, and one account per account type: `manager` (org `admin`), `teacher`
  (account type `educator`, org `member` — the case's T1), `student`.
- Seed: `bun scripts/qa-tenant.ts EDU-Q-04 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/group/users from
  `tenantKey('qa/cases/EDU-Q-04.md', 'EDU-Q-04#<suffix>', 'qa-shared')` +
  `tenantId(key, entity)`. The spec reads the ids through `loadTenant('EDU-Q-04')`.
- Prerequisite bank „Fizyka”: created through `POST /api/v1/questions/banks` in the
  tenant and reused when it already exists (personal visibility — the case only needs a
  container for the question, not a group share).
- The open question is the case's own step: the spec creates it through the
  `/edu/questions/<bank>/` dialog („Utwórz pytanie” → „Otwarta odpowiedź”).
- The second acceptance point (student types text, teacher grades manually) is prepared
  by the spec through the product API: one assignment titled „EDU-Q-04 kartkówka
  otwarta”, with the open question, targeted directly at the tenant `student` and
  published. Before each execution the spec deletes that assignment (cascading its
  attempts) and any earlier copy of the question, so a CI retry against the same seeded
  tenant (`--retries=2`) starts from the same state and every run exercises the UI
  creation step instead of reusing a duplicate.
- Not used: the legacy „Classroom Group” targeting path — the tenant student is a direct
  assignment target. No global admin setting, feature flag, plan, platform stat or
  singleton row is read or written.

## Observed on the shared app (walk, 2026-10-29, worker qa-env-8)

- `/edu/questions` lists the tenant's bank „Fizyka”; „Zarządzaj” opens
  `/edu/questions/<bank>/` („Pytania”) with the columns „Pytanie”, „Typ”, „Tematy”,
  „Odpowiedzi”, „Akcje” and the empty state „Brak pytań w tym banku. Utwórz swoje
  pierwsze pytanie!”.
- „Utwórz pytanie” opens the dialog „Utwórz pytanie” / „Dodaj nowe pytanie do tego
  banku”. The default type is „Wielokrotny wybór”, which shows the „Odpowiedzi” block
  with one „Odpowiedź 1” input, the „Dodaj odpowiedź” button and the hint „Zaznacz
  przycisk radio dla poprawnej odpowiedzi”.
- Choosing „Otwarta odpowiedź” removes that whole block — no answer inputs, no radio
  buttons, no „Dodaj odpowiedź” — and keeps „Treść pytania” and „Wyjaśnienie
  (opcjonalnie)” („Wyjaśnij, dlaczego odpowiedź jest poprawna…”). Saving answers
  „Pytanie utworzone”.
- The saved row shows the type badge „Otwarte”, „—” in „Tematy” and „0” in
  „Odpowiedzi”; `GET /api/v1/questions?bankId=…` returns `type: 'open'`, the stored
  `explanation` and `question_answers: []`.
- During the quiz (`/app/assignments/<id>/take?attemptId=…`) the same question renders as
  the free-text field „Wpisz swoją odpowiedź…” (plus the optional „Prześlij zdjęcie”)
  instead of answer options; „Wyślij” completes the attempt and the detail page shows
  „Ukończono”.
- `/edu/assignments/<id>/results/<studentId>` („Oceń ucznia”) shows the question, the raw
  type badge `open`, the model answer as „Wyjaśnienie: …”, the student's text as
  „Odpowiedź ucznia: …”, a „Punkty (0–1)” input and „Informacja zwrotna”. „Zapisz ocenę”
  changes the header from „Wynik: 0/1” to „Wynik: 1/1 (ocenione)” and stores
  `teacher_points: 1` with `graded_at` set.
