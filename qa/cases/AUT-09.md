# AUT-09 — Logowanie – parametr next (powrót do żądanej strony)

- id: AUT-09
- priority: P2 ważny
- module: AUT – Uwierzytelnianie i sesja
- section: Logowanie
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Będąc wylogowanym, otwórz bezpośrednio /app/flashcards.
2. Zaloguj się jako student1@dev.local.

## Expected result

- Najpierw przekierowanie na /login?next=%2Fapp%2Fflashcards.
- Po zalogowaniu użytkownik trafia dokładnie na /app/flashcards.
