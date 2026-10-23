# LIM-06 — Flaga globalna wyłączona

- id: LIM-06
- priority: P2 ważny
- module: LIM – Funkcje (feature flags) i limity planów
- section: Bramkowanie funkcji
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Panel admina → Funkcje.

## Steps

1. Wyłącz flagę „ai.chat” globalnie (przełącznik „Włączona”).
2. Zaloguj się jako użytkownik z planem premium (override lub Ace).

## Expected result

- Funkcja nie jest dostępna mimo planu (flaga globalna ma pierwszeństwo przed planem – zanotuj faktyczne zachowanie). Po włączeniu wraca.
