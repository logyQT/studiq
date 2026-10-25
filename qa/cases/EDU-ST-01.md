# EDU-ST-01 — Statystyki – „Treści” (/edu/stats/data)

- id: EDU-ST-01
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Statystyki nauczyciela
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany TC.

## Steps

1. Otwórz /edu/stats/data.
2. Zmień filtr „Wszystkie przedmioty”.

## Expected result

- Karty: Wszystkie pytania, fiszki, talie, studenci; karta „Studenci” pokazuje liczbę uczniów w grupach TC w aktywnej organizacji (seed Classroom: 1), a pod wartością podpis „Aktywnych: N” — liczbę studentów, którzy ćwiczyli (TC nie jest liczony).
- Po jednej powtórce studenta „Aktywnych” rośnie o 1, a pasek postępu karty jest wypełniony; powtórka samego TC nie zmienia „Aktywnych”.
- Przełączenie organizacji zmienia liczbę studentów na właściwą dla aktywnej organizacji; TC bez aktywnej organizacji nie widzi karty „Studenci” (zamiast gołego 0).
- Podział „Pytania według typu” (WW/PF/Otwarte) i „według przedmiotu”; tabele liczby talii i tematów.
- Linki „Zobacz szczegółowe statystyki pytań / fiszek” działają.
- Na /edu/flashcards/stats karta studentów ma etykietę „Studenci, którzy ćwiczyli” (bez nowej karty i bez zmiany siatki).
- TC: 10 pytań – 4 wielokrotnego wyboru, 3 prawda/fałsz, 3 otwarte (zgodnie z seedem).
