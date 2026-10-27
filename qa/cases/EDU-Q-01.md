# EDU-Q-01 — Utworzenie banku dla grupy

- id: EDU-Q-01
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Banki pytań i pytania (/edu/questions)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

T1 w WSB Merito.

## Steps

1. Kliknij „Nowy bank”, nazwa „Fizyka”, opis opcjonalny, widoczność „Grupy” → O1G1.
2. Zapisz.
3. Sprawdź widok studenta1 (/app/questions).
4. Na /edu/questions sprawdź filtr zakresu Wszystkie / Moje i filtr grup („Dowolna grupa” / „Moje grupy”).

## Expected result

- Toast „Bank pytań utworzony”; student1 widzi bank z etykietą „Podgląd banku”.
- Student spoza grupy nie widzi banku.
- Filtry banków: Wszystkie / Moje + multi-select grup; brak „Grupy” jako zakresu.
