# NFR-07 — Konsola przeglądarki i błędy serwera

- id: NFR-07
- priority: P2 ważny
- module: NFR – Wymagania niefunkcjonalne i międzyobszarowe
- section: Wydajność i stabilność
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Podczas całego testowania.

## Steps

1. Miej otwartą konsolę i zakładkę Network w trakcie wykonywania testów.
2. Zbieraj czerwone błędy, ostrzeżenia hydratacji, odpowiedzi 5xx.

## Expected result

- Brak odpowiedzi 5xx przy poprawnym użyciu i brak nieobsłużonych wyjątków; każdy znaleziony błąd zgłoś z numerem testu.
