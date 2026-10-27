# EDU-GRP-02 — Zarządzanie członkami grupy

- id: EDU-GRP-02
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Grupy nauczyciela (/edu/groups)
- prereqs: EDU-GRP-01
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Grupa z EDU-GRP-01.

## Prerequisite context

### EDU-GRP-01 — Lista i tworzenie grup

_Warunek wstępny: T1 (plan Lite – group.manage)._

1. Otwórz /edu/groups.
2. Kliknij „Nowa grupa”, nazwa „Grupa testowa”, opis; zapisz.

Expected:

- Lista grup z kolumnami Nazwa / Członkowie / Nauczyciele / Akcje.
- Toast „Grupa utworzona”.

## Steps

1. Kliknij „Zarządzaj członkami”.
2. Wybierz osoby w polu „Wybierz osoby…”, zapisz.

## Expected result

- Dostępni są wyłącznie członkowie tej organizacji.
- Toast „Skład grupy zaktualizowany”; liczniki w tabeli aktualizują się.
- Dodany student widzi treści udostępnione tej grupie.
