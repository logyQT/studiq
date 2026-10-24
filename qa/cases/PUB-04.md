# PUB-04 — Podstrona planów (/pricing/student) – karty planów

- id: PUB-04
- priority: P2 ważny
- module: PUB – Strony publiczne i nawigacja ogólna
- section: Funkcje, Cennik, Kontakt, strony prawne
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Otwórz /pricing/student.
2. Dla każdej karty sprawdź: nazwę, cenę, listę funkcji i limitów, przycisk CTA.

## Expected result

- Ceny zgodne z konfiguracją: Base 0 zł; Spark 9,99 zł; Ace 19,99 zł; Pro 49,99 zł /miesiąc (wartości wyświetlane z groszy: 999 → 9,99).
- Funkcje: Base – Fiszki, Testy; Ace/Pro – dodatkowo Asystent AI i Zaawansowane Statystyki.
- Limity wyświetlane czytelnie, „Bez ograniczeń” dla wartości -1.
- CTA różni się per plan (np. „Zacznij za Darmo”, „Przejdź na Spark”, „Wybierz Ace”, „Wybierz Pro”).
- Plan „Ace”/„Pro” ma wyróżnienie „Najpopularniejszy” (jeśli skonfigurowane).
