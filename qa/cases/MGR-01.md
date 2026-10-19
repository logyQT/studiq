# MGR-01 — Pulpit „Zarządzanie Uczelnią” (/manage)

- id: MGR-01
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Pulpit managera
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany manager@dev.local, organizacja WSB Merito.

## Steps

1. Otwórz /manage.
2. Sprawdź karty: Łączna liczba członków, Wykładowcy, Studenci.
3. Kliknij „Zaproś członków” oraz „Zarządzaj członkami”.
4. Sprawdź listę „Ostatni członkowie”.

## Expected result

- WSB Merito: łącznie 4 członków, w tym 2 wykładowców i 1 student (administrator liczy się tylko do łącznej liczby).
- Szybkie akcje prowadzą do /manage/invites i /manage/members.
- Lista ostatnich członków zgodna z członkami organizacji; stan ładowania i pusty stan („Brak członków”) bez błędów.
