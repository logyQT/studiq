# LIM-05 — Branding wymaga funkcji branding

- id: LIM-05
- priority: P1 krytyczny
- module: LIM – Funkcje (feature flags) i limity planów
- section: Bramkowanie funkcji
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

M1 (Launch).

## Steps

1. Wykonaj MGR-SET-01, MGR-SET-02, MGR-SET-05.
2. Wywołaj PUT /api/v1/organization/<id> z {"brandColor":"#ff0000"} oraz POST …/logo jako manager bez funkcji.

## Expected result

- Bez funkcji: UI blokuje, API odrzuca (403) – brak zmiany koloru/logo.
