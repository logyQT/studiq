# MGR-ROL-04 — Usuwanie ról – ograniczenia

- id: MGR-ROL-04
- priority: P1 krytyczny
- module: MGR – Panel managera organizacji (/manage)
- section: Role (/manage/roles)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Rola niestandardowa z członkiem i rola bez członków.

## Steps

1. Spróbuj usunąć rolę systemową.
2. Spróbuj usunąć rolę z przypisanym członkiem.
3. Usuń pustą rolę niestandardową.

## Expected result

- Systemowa: „Ról systemowych nie można usuwać”.
- Z członkami: „Usuń wszystkich członków z tej roli przed usunięciem”.
- Pusta niestandardowa: usunięta, toast „Rola usunięta”.
