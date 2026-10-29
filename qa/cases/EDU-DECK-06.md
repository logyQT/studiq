# EDU-DECK-06 — Statystyki fiszek (/edu/flashcards/stats)

- id: EDU-DECK-06
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Talie i fiszki nauczyciela
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Po aktywności studenta (np. S1 przerobił kilka fiszek).

## Steps

1. Otwórz /edu/flashcards/stats (z kafla „Statystyki” na hubie lub „Zobacz szczegóły fiszek”).
2. Sprawdź karty podsumowania, wykres rozkładu trudności i tabele „Podział na talie” oraz „Podział na tematy”.

## Expected result

- Karty: Talie, Fiszki, Powtórki, Studenci, Skuteczność, Śr. EF.
- Wykres: Łatwe / Średnie / Trudne / Nowe.
- Pusta baza: „Brak danych – Utwórz fiszki… Statystyki pojawią się, gdy studenci zaczną powtarzać.”

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`teacher1@dev.local`, `student1@dev.local`,
password `pass`). The suite version uses the case's own tenant and never the legacy accounts.

- Tenant: `tenantKey('qa/cases/EDU-DECK-06.md', 'EDU-DECK-06#<run>', 'qa-shared')` with a fresh
  run suffix per independent run; every id comes from `tenantId(key, entity)`. Organization
  `qa-edu-deck-06-<run>`, default group `G1`, one `educator` (org owner with org role
  `teacher` and group role `teacher`, so it owns the deck and may share it) and one `student`
  (org member and `G1` member — the „S1” of the prerequisite).
- Prerequisite „po aktywności studenta”: the spec creates the deck („EDU-DECK-06 talia”,
  `visibility: 'group'`, shared to `G1`), three cards and one topic through the product API,
  then the student logs one correct and one wrong answer (`POST /api/v1/flashcards/:id/practice`).
  The teacher's `flashcard.read` scope is `own`, so the aggregate only covers this tenant's
  cards; the teacher's own practice rows are excluded from „Studenci” (#460).
- Steps: the flashcard hub with the „Statystyki” tile no longer exists (the route now opens the
  deck list), so step 1 is walked through the second offered entry point —
  `/edu/stats/results` → „Zobacz szczegóły fiszek”.
- Copy note (P3, not a defect): the summary card the case calls „Studenci” is labelled
  „Studenci, którzy ćwiczyli” since #460; the spec asserts the current label.
- Nothing global is read or written: no admin setting, feature flag, plan, platform stat or
  singleton row.
