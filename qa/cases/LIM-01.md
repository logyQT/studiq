# LIM-01 — Macierz limitów – podgląd w panelu admina

- id: LIM-01
- priority: P2 ważny
- module: LIM – Funkcje (feature flags) i limity planów
- section: Egzekwowanie limitów
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Panel admina → Plany.

## Steps

1. Rozwiń wiersz planu (strzałka) dla Base, Lite, Launch, Spark, Ace, Pro.

## Expected result

- Base: fiszki 100, pytania 50, talie 10, banki 5, próby dziennie 10, tokeny AI 0.
- Lite: jak Base + grupy 1, studenci 5. Launch: jak Base + grupy 3, studenci 5.
- Spark: 500/200/50/20/50/0. Ace: 2000/1000/200/100/-1/200000. Pro: wszystko -1 (bez ograniczeń).
- Wartość -1 prezentowana jako bez ograniczeń.
