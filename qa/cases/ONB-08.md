# ONB-08 — Rejestracja z zaproszenia – ścieżka poprawna

- id: ONB-08
- priority: P2 ważny
- module: ONB – Onboarding, organizacje i zaproszenia
- section: Zaproszenie przez link (/join?token=…)
- prereqs: MGR-INV-01
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Wygenerowane zaproszenie dla nowego e-maila (MGR-INV-01). Skopiowany „link zaproszenia”.

## Prerequisite context

### MGR-INV-01 — Wysłanie zaproszenia z rolą

_Warunek wstępny: M1, WSB Merito (4/5 członków)._

1. Otwórz /manage/invites.
2. Wpisz e-mail invite1@example.com, wybierz rolę „member”.
3. Kliknij „Wyślij zaproszenia”.
4. W sekcji „Wyniki” kliknij „Kopiuj link”.

Expected:

- Toast „Wysłano 1 zaproszeń.”; w sekcji „Wyniki” plakietka „Sukces” i przycisk „Kopiuj link” (toast „Skopiowano!”).
- W tabeli „Wysłane zaproszenia” nowe zaproszenie ze statusem „Oczekujące”.
- W Inbucket brak wiadomości lub wiadomość z linkiem (zanotuj – jeżeli mail nie jest wysyłany, link kopiowany ręcznie).

## Steps

1. W oknie bez sesji otwórz link zaproszenia (/join?token=…).
2. Sprawdź formularz: pola imię i e-mail.
3. Wpisz hasło i kliknij przycisk aktywacji konta.
4. Aktywuj konto linkiem z Inbucket i zaloguj się.

## Expected result

- Najpierw szkielet „Verifying invitation…”, potem formularz z wstępnie wypełnionymi i zablokowanymi (tylko do odczytu) polami imię i e-mail.
- Po zapisaniu toast sukcesu i przejście na /login.
- ZANOTUJ: na ekranie /join teksty nagłówka, opisu i przycisku mogą być wyświetlone jako surowe klucze (join_title, join_desc, activate_account) – w pliku tłumaczeń namespace RegisterPage tych kluczy brakuje.
- Po aktywacji i zalogowaniu użytkownik jest członkiem zapraszającej organizacji z rolą przypisaną w zaproszeniu.
