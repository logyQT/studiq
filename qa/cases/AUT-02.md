# AUT-02 — Rejestracja nauczyciela i managera

- id: AUT-02
- priority: P2 ważny
- module: AUT – Uwierzytelnianie i sesja
- section: Rejestracja
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Zarejestruj konto „Test Nauczyciel” (test.teacher01@example.com, Haslo1234) z typem „Nauczycielem”.
2. Zarejestruj konto „Test Manager” (test.manager01@example.com, Haslo1234) z typem „Menedżerem”.
3. Aktywuj oba konta linkami z Inbucket i zaloguj się na każde.

## Expected result

- Nauczyciel po zalogowaniu trafia na /setup (konfiguracja klasy) – patrz ONB-01.
- Manager po zalogowaniu trafia na /setup/org – patrz ONB-04.
- Każdy typ konta ma w tokenie właściwy account_type (educator / manager).
