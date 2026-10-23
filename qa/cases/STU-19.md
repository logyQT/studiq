# STU-19 — Import talii/fiszek z CSV (lista talii)

- id: STU-19
- priority: P1 krytyczny
- module: STU – Panel studenta (/app)
- section: Talie (/app/flashcards)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Plik fiszki_poprawne.csv (folder Studiq_dane_testowe).

## Steps

1. Na liście talii wybierz „Importuj CSV”.
2. Przeciągnij plik lub kliknij „Upuść plik CSV tutaj…”.
3. Zmapuj kolumny „Przód” (front), „Tył” (back), opcjonalnie „Temat” i „Talia”.
4. Wpisz nazwę talii (domyślnie „Zaimportowane Fiszki”) i kliknij „Importuj N fiszek”.

## Expected result

- Podgląd: „Znaleziono N wierszy” i „Wyświetlanie X z N wierszy”.
- Po imporcie „Import zakończony – Zaimportowano N z N fiszek”.
- Utworzona talia zawiera wszystkie fiszki z poprawnym przodem/tyłem i tematami.
