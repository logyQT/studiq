# STU-36 — Kartkówka – maks. liczba prób

- id: STU-36
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Kartkówki studenta (/app/assignments)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Kartkówka z maks. prób = 1.

## Steps

1. Ukończ kartkówkę.
2. Spróbuj ją rozpocząć ponownie (z listy oraz bezpośrednim URL /api/v1/assignments/<id>/start).

## Expected result

- Nie można zacząć drugiej próby ponad limit; UI ukrywa przycisk startu lub pokazuje błąd.
- Wywołanie API zwraca błąd (nie tworzy kolejnej próby).
