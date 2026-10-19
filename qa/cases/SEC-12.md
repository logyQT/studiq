# SEC-12 — Endpointy deweloperskie

- id: SEC-12
- priority: P2 ważny
- module: SEC – Autoryzacja i izolacja danych
- section: Walidacja wejścia i odporność
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Środowisko development i (jeśli możliwe) build produkcyjny.

## Steps

1. Wywołaj GET /api/v1/dev/traces oraz POST /api/v1/dev/study-simulate {"email":"student1@dev.local"}.
2. Powtórz na buildzie produkcyjnym (bun build, bun start).

## Expected result

- W development działają. W buildzie produkcyjnym: traces → 403 „Only available in development mode”, study-simulate → 404 „Not available in production”. Jakakolwiek inna odpowiedź = defekt krytyczny.
