# LIM-07 — Nadpisanie funkcji dla użytkownika (user override)

- id: LIM-07
- priority: P2 ważny
- module: LIM – Funkcje (feature flags) i limity planów
- section: Bramkowanie funkcji
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Panel admina → Nadpisania.

## Steps

1. Utwórz nadpisanie: użytkownik student1, funkcja „ai.chat”, włączone, powód „test”, wygasa za 1 minutę.
2. Sprawdź pozycję „Asystent Q” przed i po wygaśnięciu.

## Expected result

- Funkcja pojawia się po utworzeniu i znika po wygaśnięciu nadpisania (po odświeżeniu).
