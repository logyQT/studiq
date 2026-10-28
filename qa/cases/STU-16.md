# STU-16 — Edycja talii

- id: STU-16
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Talie (/app/flashcards)
- prereqs: STU-15
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Własna talia z STU-15.

## Prerequisite context

### STU-15 — Utworzenie talii

_Warunek wstępny: Zalogowany student1._

1. Kliknij „Nowa talia”.
2. Wpisz nazwę „Biologia – rozdział 1” i opis „Komórka”.
3. Zostaw widoczność „Tylko ja” i kliknij „Utwórz”.

Expected:

- Toast „Talia utworzona”; talia widoczna na liście z 0 fiszek.
- Talia ma etykietę „Zarządzaj” (właściciel).

## Steps

1. Otwórz menu talii → „Edytuj” (lub z widoku talii „Edytuj Talię”).
2. Zmień nazwę i opis; zapisz.

## Expected result

- Toast „Talia zaktualizowana”; nowa nazwa/opis widoczne na liście i w widoku talii.
