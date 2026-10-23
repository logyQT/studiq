# EDU-QZ-04 — Autozapis i zapis ręczny

- id: EDU-QZ-04
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Quizy – kreator (/edu/quizzes)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Edytor quizu.

## Steps

1. Wprowadź zmianę i odczekaj kilka sekund.
2. W DevTools ustaw „Offline” i wprowadź kolejną zmianę.
3. Kliknij „Zapisz”.

## Expected result

- Po chwili toast „Zapisano”; przy błędzie sieci „Autozapis nieudany” / „Zapis nieudany”.
- Po przywróceniu sieci zapis ręczny przechodzi i wskaźnik „Niezapisane zmiany” znika.
- Odświeżenie strony po zapisie zachowuje zmiany.
