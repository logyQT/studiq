# ONB-06 — Student – dołączenie do klasy kodem (/app/join)

- id: ONB-06
- priority: P2 ważny
- module: ONB – Onboarding, organizacje i zaproszenia
- section: Student – dołączenie do klasy, przełączanie organizacji
- prereqs: MGR-INV-01
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Student3 + świeże zaproszenie dla jego e-maila (MGR-INV-01 z rolą „member”).

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

1. Wybierz „Dołącz do klasy” (lub otwórz /app/join).
2. Wklej kod zaproszenia i kliknij „Dołącz”.
3. Powtórz z niepoprawnym kodem.

## Expected result

- Poprawny kod → toast „Dołączyłeś do klasy!” i odświeżenie; przełącznik pokazuje nową organizację.
- Zły/wygasły kod → toast „Nieprawidłowy lub wygasły kod zaproszenia”.
- Puste pole – przycisk nie wysyła żądania.
