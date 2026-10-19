# PUB-07 — Strona 404 (niezalogowany)

- id: PUB-07
- priority: P2 ważny
- module: PUB – Strony publiczne i nawigacja ogólna
- section: Obsługa błędów i zasoby techniczne
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Otwórz http://localhost:3000/nie-ma-takiej-strony.
2. Kliknij „Wróć do strony głównej”.

## Expected result

- Widoczny komunikat „Nie znaleziono strony” z opisem.
- Link „Sprawdź status systemu” (jeśli widoczny) działa lub zanotuj dokąd prowadzi.
- Przycisk wraca na „/”.
