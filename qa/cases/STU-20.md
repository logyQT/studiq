# STU-20 — Import CSV – błędne dane

- id: STU-20
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Talie (/app/flashcards)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Pliki fiszki_bledne.csv oraz plik tekstowy nie-CSV.

## Steps

1. Wczytaj fiszki_bledne.csv (wiersze bez „back”, puste, ze znakami specjalnymi).
2. Spróbuj zaimportować bez mapowania kolumn.
3. Wczytaj plik .txt/.png zamiast CSV.

## Expected result

- Błędy w podsumowaniu: „N błędów” z numerem wiersza i opisem („Wiersz / Błąd”); poprawne wiersze zostają zaimportowane.
- Bez mapowania: „Proszę przypisać kolumny Przód i Tył”.
- Zły typ pliku: „Nie udało się sparsować pliku CSV” (bez awarii).
