# AUT-01 — Rejestracja studenta – ścieżka poprawna

- id: AUT-01
- priority: P1 krytyczny
- module: AUT – Uwierzytelnianie i sesja
- section: Rejestracja
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji. Skrzynka Inbucket otwarta w drugiej karcie.

## Steps

1. Otwórz /register.
2. Wpisz Imię i Nazwisko: „Test Student”, e-mail: test.student01@example.com, hasło: „Haslo1234”.
3. W polu „Jestem” wybierz „Uczniem”. Kliknij „Zarejestruj się”.
4. Otwórz skrzynkę Inbucket, znajdź wiadomość do test.student01@example.com i kliknij link aktywacyjny.
5. Po aktywacji wejdź na /login i zaloguj się danymi z kroku 2.

## Expected result

- Po wysłaniu formularza ekran „Konto zostało utworzone” z komunikatem „Link aktywacyjny został wysłany…” i przyciskiem „Przejdź do logowania”.
- W skrzynce jest 1 wiadomość z linkiem potwierdzającym.
- Po kliknięciu linku użytkownik jest zalogowany/przekierowany bez błędu (lub trafia na /login bez komunikatu błędu).
- Logowanie kończy się przekierowaniem do /app (panel studenta).
