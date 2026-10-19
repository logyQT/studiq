# SEC-08 — Edycja cudzych zasobów (IDOR)

- id: SEC-08
- priority: P1 krytyczny
- module: SEC – Autoryzacja i izolacja danych
- section: Uprawnienia ról
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

student1 i student2.

## Steps

1. Jako student1 zapisz UUID własnej fiszki (O1S1).
2. Jako student2 wykonaj PUT /api/v1/flashcards/<UUID fiszki S1> {front:"hack"}.
3. DELETE /api/v1/flashcards/decks/<UUID talii S1>.

## Expected result

- Odmowa (403/404); fiszka i talia S1 pozostają nietknięte.
