# ADM-ORG-02 — Szczegóły organizacji

- id: ADM-ORG-02
- priority: P2 ważny
- module: ADM – Panel administracyjny (apps/admin, port 4000)
- section: Organizacje (/orgs)
- prereqs: ADM-ORG-01
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

ADM-ORG-01.

## Prerequisite context

### ADM-ORG-01 — Lista organizacji

_Warunek wstępny: Baza po resecie._

1. Otwórz /orgs.

Expected:

- Cztery organizacje: WSB Merito, UE Wrocław, Akademia Górnicza, Classroom z liczbą członków, grup, ról i datą utworzenia.

## Steps

1. Kliknij „WSB Merito”.
2. Przejrzyj zakładki Członkowie, Grupy, Role.
3. Otwórz nieistniejące ID organizacji.

## Expected result

- Karty: Członkowie 4, Grupy 2, Role 3; zakładki z tabelami (Nazwa, E-mail, Rola, Dołączył / Grupa, Członkowie, Nauczyciele / Rola, Systemowa, Uprawnienia).
- Nieistniejąca organizacja → „Nie znaleziono organizacji.”
