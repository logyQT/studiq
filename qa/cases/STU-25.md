# STU-25 — Połączenie fiszki z inną talią (link)

- id: STU-25
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Fiszki w talii (/app/flashcards/<id>)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Dwie własne talie A i B, fiszka w A.

## Steps

1. W menu fiszki wybierz „Połącz z Inną Talią”.
2. Zaznacz talię B i kliknij „Połącz z 1 talią”.
3. Edytuj fiszkę w talii A i sprawdź ją w talii B.

## Expected result

- Toast „Fiszka połączona z taliami”.
- Ta sama fiszka jest widoczna w obu taliach, zmiany synchronizują się.
- Brak innych talii → „Brak innych talii”.
