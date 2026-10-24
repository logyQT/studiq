# PUB-08 — 404 wewnątrz paneli (student / nauczyciel / manager)

- id: PUB-08
- priority: P2 ważny
- module: PUB – Strony publiczne i nawigacja ogólna
- section: Obsługa błędów i zasoby techniczne
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany kolejno jako S1, T1, M1.

## Steps

1. Jako student1 otwórz /app/nie-istnieje.
2. Jako teacher1 otwórz /edu/nie-istnieje.
3. Jako manager otwórz /manage/nie-istnieje.

## Expected result

- Student: „No to niezłe combo…” z linkami do Fiszki / Quiz / Statystyki.
- Nauczyciel: „Nie znaleziono strony” z linkami Przegląd / Pytania / Fiszki / Statystyki / Klasa.
- Manager: „Nie znaleziono strony” z linkami Przegląd / Członkowie / Zaproszenia / Ustawienia.
- Układ panelu (sidebar) pozostaje widoczny.
