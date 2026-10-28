# PUB-03 — Strona „Cennik” (/pricing) – kafelki typów kont

- id: PUB-03
- priority: P1 krytyczny
- module: PUB – Strony publiczne i nawigacja ogólna
- section: Funkcje, Cennik, Kontakt, strony prawne
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Otwórz /pricing.
2. Sprawdź trzy kafelki: Student, Edukator, Organizacja.
3. Kliknij kafelek „Student”, wróć, powtórz dla „Edukator” i „Organizacja”.

## Expected result

- Tytuł „Wybierz Swój Plan” i podtytuł „Zacznij za darmo, ulepsz gdy potrzebujesz więcej”.
- Trzy kafelki (Student / Edukator / Organizacja) z ikoną, nazwą i opisem. Cały kafelek jest klikalny (link nakładkowy) — brak osobnego przycisku „Zobacz N plany” i brak licznika planów na kafelku.
- Kliknięcie kafelka „Student” → /pricing/student z 4 planami: Base, Spark, Ace, Pro.
- Kliknięcie kafelka „Edukator” → /pricing/edu z 4 planami: Lite, Guide, Creator, Master.
- Kliknięcie kafelka „Organizacja” → /pricing/org z 4 planami: Launch, Team, Hub, Campus.
- Powrót na /pricing przez link „Cennik” w nagłówku (strona planów nie ma osobnego linku „Powrót do planów”).
