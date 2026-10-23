# BIL-01 — Strona rozliczeń studenta (/app/billing)

- id: BIL-01
- priority: P2 ważny
- module: BIL – Plany, rozliczenia i płatność (symulowana)
- section: Aktualny plan i strony rozliczeń
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany student1 (plan Base).

## Steps

1. Otwórz „Płatności” z menu użytkownika.

## Expected result

- Tytuł „Rozliczenia”, karta „Aktualny plan: StudiQ Base”, plakietka „Darmowy”.
- Lista funkcji (Fiszki, Testy) i limitów (m.in. Maks. fiszki 100, Maks. talie 10, Maks. pytania 50, Próby dziennie 10, Tokeny AI / dzień 0) bez „NaN”.
- Przycisk „Wybierz plan” prowadzi do /app/upgrade.
