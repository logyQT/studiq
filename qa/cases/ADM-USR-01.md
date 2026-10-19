# ADM-USR-01 — Lista użytkowników i wyszukiwanie

- id: ADM-USR-01
- priority: P2 ważny
- module: ADM – Panel administracyjny (apps/admin, port 4000)
- section: Użytkownicy (/users) – pełne zarządzanie z 30-dniowym koszem
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Wersja z modułem użytkowników.

## Steps

1. Otwórz /users.
2. Wpisz „teacher” w „Szukaj po e-mailu lub imieniu…”.
3. Sprawdź stronicowanie.

## Expected result

- Zakładki „Aktywni” / „Usunięci”; tabela: Email, Imię i nazwisko, Typ konta, Plan, Utworzono.
- 10 seedowych użytkowników; wyszukiwanie po e-mailu i imieniu.
- Pasek „Strona X z Y (N łącznie)”.
