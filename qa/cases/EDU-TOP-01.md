# EDU-TOP-01 — Tematy nauczyciela – CRUD i widoczność

- id: EDU-TOP-01
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Tematy (/edu/topics)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany teacher1.

## Steps

1. Otwórz /edu/topics.
2. Utwórz temat „Algebra”.
3. Zmień nazwę, a następnie usuń.
4. Sprawdź filtr zakresu Wszystkie / Moje i filtr grup („Dowolna grupa” / „Moje grupy”).

## Expected result

- Toasty utworzenia/aktualizacji/usunięcia; pusta nazwa → „Nazwa tematu jest wymagana”.
- Temat powiązany z fiszkami/pytaniami pokazuje poprawną liczbę fiszek.
- Filtry: Wszystkie / Moje + multi-select grup; brak opcji „Udostępnione”.
