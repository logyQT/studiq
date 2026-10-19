# SEC-01 — Student nie widzi treści innej grupy

- id: SEC-01
- priority: P1 krytyczny
- module: SEC – Autoryzacja i izolacja danych
- section: Izolacja między organizacjami i grupami
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

student1 (O1G1).

## Steps

1. Otwórz /app/flashcards/00000000-0000-4000-8006-000000000002 (talia O1G2T2 z innej grupy).
2. Wywołaj fetch('/api/v1/flashcards/decks/00000000-0000-4000-8006-000000000002').
3. Wywołaj fetch('/api/v1/questions/banks') i sprawdź listę.

## Expected result

- Strona: „Nie znaleziono talii”. API: 404/403, brak danych talii.
- Lista banków zawiera tylko banki dostępne dla S1 (np. O1G1T1).
