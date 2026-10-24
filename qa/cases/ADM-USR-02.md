# ADM-USR-02 — Utworzenie użytkownika

- id: ADM-USR-02
- priority: P1 krytyczny
- module: ADM – Panel administracyjny (apps/admin, port 4000)
- section: Użytkownicy (/users) – pełne zarządzanie z 30-dniowym koszem
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Panel admina.

## Steps

1. Kliknij „Utwórz użytkownika”.
2. Wpisz e-mail created@example.com, hasło „Haslo1234”, imię, typ konta „Student”.
3. Zapisz, następnie zaloguj się tym kontem w aplikacji web.

## Expected result

- Użytkownik pojawia się na liście z typem konta Student; konto jest od razu aktywne (e-mail potwierdzony).
- Logowanie w aplikacji web działa i prowadzi do /app.
- Istniejący e-mail → komunikat o konflikcie.
