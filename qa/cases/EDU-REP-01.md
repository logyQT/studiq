# EDU-REP-01 — Lista zgłoszeń nauczyciela

- id: EDU-REP-01
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Zgłoszenia (nauczyciel)
- prereqs: STU-39
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Student zgłosił błąd w pytaniu/fiszce T1 (STU-39).

## Prerequisite context

### STU-39 — Zgłoszenie błędnej fiszki

_Warunek wstępny: S1, talia O1G1T1 (autor T1)._

1. W menu fiszki wybierz „Zgłoś nieprawidłowość”.
2. Wpisz „Odpowiedź jest błędna” i kliknij „Wyślij”.
3. Otwórz /app/reports.

Expected:

- Okno „Zgłoś nieprawidłowość pytania”, po wysłaniu toast „Zgłoszenie wysłane”.
- Zgłoszenie widoczne na liście /app/reports z treścią i statusem przeczytania.

## Steps

1. Zaloguj się jako teacher1 i otwórz /edu/reports.

## Expected result

- Opis „Zgłoszenia nieprawidłowości od studentów dotyczące Twoich pytań.” i lista zgłoszeń z treścią, autorem, datą.
- Plakietka nieprzeczytanych przy „Zgłoszenia” w menu.
