# STU-29 — Fiszka z talii nauczyciela – tylko do odczytu

- id: STU-29
- priority: P1 krytyczny
- module: STU – Panel studenta (/app)
- section: Fiszki w talii (/app/flashcards/<id>)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

S1 otwiera talię „O1G1T1” (należącą do T1).

## Steps

1. Otwórz talię O1G1T1.
2. Sprawdź menu fiszki i dostępne akcje (edycja, usuwanie, nowa fiszka).
3. Spróbuj wejść na /api/v1/flashcards/<id fiszki> metodą PUT/DELETE (np. przez DevTools fetch).

## Expected result

- Etykieta „Podgląd” zamiast „Zarządzaj”; brak możliwości edycji/usuwania cudzej fiszki w interfejsie.
- W menu fiszki dostępna opcja „Zgłoś nieprawidłowość”.
- Wywołanie API modyfikujące cudzą fiszkę zwraca 403/404 (RLS) – dane nie zmieniają się.
