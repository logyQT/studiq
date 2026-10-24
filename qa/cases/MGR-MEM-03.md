# MGR-MEM-03 — Zmiana własnej roli / ostatni admin

- id: MGR-MEM-03
- priority: P1 krytyczny
- module: MGR – Panel managera organizacji (/manage)
- section: Członkowie (/manage/members)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

M1 jest jedynym adminem WSB Merito.

## Steps

1. Spróbuj zmienić własną rolę admina na Member.
2. Spróbuj usunąć siebie z organizacji.

## Expected result

- Aplikacja nie powinna pozwolić na pozostawienie organizacji bez administratora; oczekiwany jest błąd lub zablokowana akcja. Zanotuj faktyczne zachowanie (potencjalnie krytyczne).
