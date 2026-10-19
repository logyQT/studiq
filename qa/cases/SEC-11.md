# SEC-11 — Przesyłanie plików – typy i rozmiary

- id: SEC-11
- priority: P2 ważny
- module: SEC – Autoryzacja i izolacja danych
- section: Walidacja wejścia i odporność
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Punkty uploadu: logo (manager), media fiszek, zdjęcia kartkówki, CSV, PDF AI.

## Steps

1. Do każdego uploadu spróbuj wgrać plik .exe, .html, .svg z JavaScriptem i plik > 20 MB.

## Expected result

- Niedozwolone typy odrzucone po stronie serwera (nie tylko w selektorze); pliki aktywne (html/svg) nie wykonują się po otwarciu.
