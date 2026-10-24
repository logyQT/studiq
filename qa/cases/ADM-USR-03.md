# ADM-USR-03 — Zmiana typu konta

- id: ADM-USR-03
- priority: P2 ważny
- module: ADM – Panel administracyjny (apps/admin, port 4000)
- section: Użytkownicy (/users) – pełne zarządzanie z 30-dniowym koszem
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Użytkownik created@example.com.

## Steps

1. Kliknij „Zmień rolę”, wybierz „Edukator”, zapisz.
2. Zaloguj się ponownie w aplikacji web.

## Expected result

- Typ konta zmienia się na liście; po ponownym logowaniu użytkownik trafia do /edu (nowy token).
