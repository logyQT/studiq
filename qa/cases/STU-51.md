# STU-51 — Zmiana hasła w koncie

- id: STU-51
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Konto studenta (/app/account)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Konto TS (hasło pass).

## Steps

1. W sekcji „Zmień hasło” wpisz obecne hasło „pass”, nowe „Nowe1234”, potwierdzenie „Inne1234” → zapisz.
2. Popraw potwierdzenie i zapisz.
3. Spróbuj podać błędne obecne hasło.
4. Wyloguj i zaloguj nowym hasłem; PRZYWRÓĆ „pass”.

## Expected result

- Niezgodne hasła → „Hasła nie są zgodne”.
- Poprawna zmiana → „Hasło zaktualizowane pomyślnie”.
- Błędne obecne hasło → odrzucenie z komunikatem (zanotuj treść).
- Nowe hasło musi spełniać reguły (min. 8 znaków, wielka litera, cyfra).
