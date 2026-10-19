# STU-07 — Harmonogram powtórek zmienia się po ocenie

- id: STU-07
- priority: P1 krytyczny
- module: STU – Panel studenta (/app)
- section: Nauka fiszek – „Ucz się” (algorytm SM-2)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Sesja z kilkoma nowymi fiszkami.

## Steps

1. Oceń fiszkę A jako „Łatwe”, fiszkę B jako „Nie pamiętam”.
2. Zakończ sesję i otwórz /app/stats/content (Treści) – tabela fiszek.
3. Porównaj kolumny Stan, Próby, Poprawność, EF, Interwał dla A i B.

## Expected result

- Fiszka A ma większy interwał / wyższy EF niż B; B ma wpisaną pomyłkę (kolumna „Pomyłki”/lapse) i jest w stanie nauki/poprawki.
- Pozycja „Następna powtórka:” w podglądzie fiszki odpowiada ocenie.
