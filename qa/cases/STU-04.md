# STU-04 — Strona „Ucz się” – stan z fiszkami do powtórki

- id: STU-04
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Nauka fiszek – „Ucz się” (algorytm SM-2)
- prereqs: none (self-contained tenant — see Seed)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany student1; w O1G1T1 i O1S1 są fiszki.

## Seed (QA-suite)

- Tenant: `bun scripts/qa-tenant.ts STU-04 --fresh`, profile `content`
  (`qa/tests/profiles/STU-04.json`) — its own organization, manager, teacher and student.
- Accounts: the legacy `student1@dev.local` is the tenant's `users.student`
  (`loginAs(page, tenant, 'student')`); no legacy/manual account is used.
- Content: the legacy O1G1T1/O1S1 decks are replaced by a deck the spec creates through
  the flashcard API for that student (20 cards), so the page starts in the „Nowe karty”
  state. Two of those cards are reviewed and only their own review-state rows are aged
  five minutes into the past to reach the „Przegląd” state.
- UI note: the case calls the target setter a „suwak”; the shipped control is a numeric
  input (1–100). The „Cel: N poprawnych” label and the settable target are what the test
  asserts.

## Steps

1. Otwórz /app/study (lub „Ucz się”).
2. Sprawdź licznik „fiszek oczekuje na powtórkę” / „nowych kart dostępnych do nauki”.
3. Sprawdź przełącznik trybu „Bez limitu / Limitowany”.

## Expected result

- Karta „Przegląd” z liczbą zaległych albo „Nowe karty” z paskiem dziennego limitu (domyślnie 20 nowych kart dziennie – „X z 20 nowych kart dzisiaj”).
- Opis trybu zmienia się: „Kontynuuj aż wszystkie fiszki zostaną przejrane” vs „Przeglądaj aż osiągniesz docelową liczbę poprawnych”.
- W trybie Limitowany pojawia się suwak „Cel: N poprawnych”.
