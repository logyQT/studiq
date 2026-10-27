# AUT-13 — Ustawienie nowego hasła z linku

- id: AUT-13
- priority: P2 ważny
- module: AUT – Uwierzytelnianie i sesja
- section: Reset hasła, wylogowanie, sesja
- prereqs: AUT-12
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Link z AUT-12.

## Prerequisite context

### AUT-12 — Zapomniane hasło – wysłanie linku

_Warunek wstępny: Brak sesji._

1. Otwórz /password/reset.
2. Wpisz student1@dev.local i kliknij „Wyślij link”.
3. Otwórz Inbucket.

Expected:

- Komunikat „Instrukcje zostały wysłane. Sprawdź swoją skrzynkę e-mail.”
- W Inbucket jest wiadomość z linkiem resetującym.

## Steps

1. Kliknij link z wiadomości.
2. Na /password/update wpisz nowe hasło „Nowe1234” i potwierdzenie „Inne1234”, kliknij „Zapisz hasło”.
3. Popraw potwierdzenie na „Nowe1234” i zapisz.
4. Wyloguj się i zaloguj nowym hasłem; spróbuj starym hasłem „pass”.

## Expected result

- Niezgodne hasła → „Podane hasła nie są identyczne.”
- Poprawny zapis → „Hasło zostało zmienione. Witaj z powrotem!” i przekierowanie do panelu.
- Nowe hasło działa, stare jest odrzucone.
- UWAGA: po teście przywróć hasło „pass” dla student1 (zmiana hasła w koncie lub db reset), aby nie psuć kolejnych testów.
