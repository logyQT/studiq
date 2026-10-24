# MGR-MEM-04 — Usunięcie członka z organizacji

- id: MGR-MEM-04
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Członkowie (/manage/members)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Dodatkowy członek testowy (np. po akceptacji zaproszenia).

## Steps

1. Wybierz akcję usuń przy członku, w oknie „Usunąć z organizacji?” potwierdź.
2. Odśwież stronę.
3. Zaloguj się jako usunięty użytkownik.

## Expected result

- Toast „Członek usunięty z organizacji”.
- Po odświeżeniu członek znika z listy (UWAGA: bezpośrednio po akcji interfejs może pozostawić go na liście z rolą „member” – zanotuj).
- Usunięty użytkownik traci dostęp do danych organizacji.
