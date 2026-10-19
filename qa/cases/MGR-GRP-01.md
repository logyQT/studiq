# MGR-GRP-01 — Lista, tworzenie, edycja i usuwanie grup

- id: MGR-GRP-01
- priority: P1 krytyczny
- module: MGR – Panel managera organizacji (/manage)
- section: Grupy (/manage/groups)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

M1, WSB Merito (2 grupy).

## Steps

1. Otwórz /manage/groups.
2. Utwórz grupę „Grupa C” z opisem.
3. Edytuj nazwę, a następnie usuń.

## Expected result

- Tabela: Nazwa, Członkowie, Nauczyciele, Akcje.
- Toasty „Grupa utworzona”, „Grupa zaktualizowana”, „Grupa usunięta”; okno usunięcia zawiera ostrzeżenie o usunięciu członków z grupy.
