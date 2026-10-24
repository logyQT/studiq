# STU-01 — Pulpit studenta – widok i statystyki

- id: STU-01
- priority: P1 krytyczny
- module: STU – Panel studenta (/app)
- section: Pulpit (/app)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany student1@dev.local.

## Steps

1. Otwórz /app.
2. Sprawdź nagłówek z datą, powitanie i karty statystyk.
3. Kliknij „Kontynuuj przegląd”, wróć, kliknij „Utwórz talię”.

## Expected result

- Powitanie „Cześć, S1.” (pierwszy człon imienia) oraz zdanie „Masz N fiszek do powtórki dzisiaj” z poprawną odmianą liczebnika.
- Karty: Przećwiczone fiszki, Średni wynik (%), Ukończone testy, Skuteczność – liczby bez „NaN” / „undefined”.
- „Kontynuuj przegląd” → /app/study (przekierowanie do /app/study/learn); „Utwórz talię” → /app/flashcards.
- W trakcie ładowania karty pokazują „…”.
