# STU-50 — Zmiana nazwy

- id: STU-50
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Konto studenta (/app/account)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Konto TS.

## Steps

1. Zmień nazwę na „Anna Nowak” i zapisz.
2. Odśwież stronę, sprawdź pasek boczny i powitanie na pulpicie.
3. Spróbuj zapisać nazwę „A” i „Anna123”.

## Expected result

- Toast „Nazwa zaktualizowana pomyślnie”; nowa nazwa widoczna w całej aplikacji po odświeżeniu.
- Nieprawidłowa nazwa → komunikaty „…za krótkie” / „…niedozwolone znaki”.
