# BIL-07 — Zmiana ceny w panelu admina widoczna w cenniku

- id: BIL-07
- priority: P2 ważny
- module: BIL – Plany, rozliczenia i płatność (symulowana)
- section: Cennik a konfiguracja z panelu admina
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Panel admina (ADM-PLN) i web.

## Steps

1. W panelu admina zmień cenę miesięczną planu „Spark” z 999 na 1299 (grosze).
2. Odśwież /pricing/student oraz /app/upgrade.
3. Przywróć 999.

## Expected result

- Cennik pokazuje 12,99 zł, po przywróceniu – 9,99 zł.
- Zmiana bez restartu aplikacji (ewentualnie po krótkim buforowaniu – zanotuj czas).
