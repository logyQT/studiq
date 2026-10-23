# MGR-INV-02 — Zaproszenia zbiorcze (wiele wierszy)

- id: MGR-INV-02
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Zaproszenia (/manage/invites)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

M1.

## Steps

1. Dodaj 3 wiersze przyciskiem „Dodaj kolejną”, wpisz różne e-maile i role (jeden wiersz usuń ikoną X).
2. Wyślij.

## Expected result

- Pole usunięcia wiersza dostępne tylko przy > 1 wierszu; wyniki dla każdego e-maila z osobnym statusem.
- Wiersze bez e-maila/roli są pomijane; gdy nie ma żadnych poprawnych – toast „Dodaj przynajmniej jeden e-mail z rolą.”.
