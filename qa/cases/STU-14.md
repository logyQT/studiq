# STU-14 — Lista talii – widok i filtry własności

- id: STU-14
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Talie (/app/flashcards)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany student1.

## Steps

1. Otwórz /app/flashcards.
2. Przełącz filtr zakresu: Wszystkie / Moje.
3. Wybierz w filtrze grup „Moje grupy”, a następnie wyczyść wybór („Dowolna grupa”).

## Expected result

- Widoczne talie: „O1G1T1” (grupowa, od T1) oraz „O1S1” (osobista).
- Talia „O1G2T2” NIE jest widoczna (inna grupa).
- „Moje” = tylko O1S1; wybór grupy „O1G1” zawęża listę do talii udostępnionych tej grupie; brak opcji „Grupy” / „Udostępnione”. Plakietka grupy „O1G1” widoczna na talii grupowej.
- Licznik talii zgodny z odmianą („2 talie”).
