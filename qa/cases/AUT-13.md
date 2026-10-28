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

## Seed (QA-suite tenant)

Automatyzacja nie używa konta `student1@dev.local` ani hasła `pass`. Każde
niezależne uruchomienie dostaje własny, świeżo zaseedowany tenant:

```bash
bun scripts/qa-tenant.ts AUT-13 --fresh
```

- Profil tenanta: `qa/tests/profiles/AUT-13.json` = `{"profile": "bare", "role": "student"}`.

- Klucz tenanta: `AUT-13.md::AUT-13#<run>::qa-shared` —
  `tenantKey('qa/cases/AUT-13.md', 'AUT-13#<run>', 'qa-shared')`, ten sam schemat co
  fixture'y e2e (bez nowego schematu ID).
- Konto: student z profilu `bare` (bez organizacji i grupy), potwierdzony e-mail,
  hasło startowe `Seed4Test!` — odpowiednik „starego” hasła z dokumentu.
  `--fresh` gwarantuje, że konto nie istniało wcześniej, więc hasło startowe jest
  zawsze aktualne, a link resetujący należy wyłącznie do tego przebiegu.
- Nowe hasło i potwierdzenie są deterministyczne per przebieg i wyprowadzone z
  klucza tenanta (`Nowe1234<shortHash>`, `Inne1234<shortHash>`) zamiast literalnych
  „Nowe1234”/„Inne1234”: dzięki temu kolejny przebieg nie trafia w Supabase
  `same_password` (422), a niezgodne potwierdzenie zawsze różni się od nowego hasła.
- Link resetujący: komunikat „StudiQ - Password Reset” w Mailpicie wspólnego stacka
  (`http://localhost:54424`), adres
  `/auth/callback?token_hash=…&type=recovery&next=/password/update`. Spec czyta
  wyłącznie pocztę zaadresowaną na własne konto tenanta.
- UWAGA z dokumentu o przywracaniu hasła dotyczy współdzielonego konta ręcznego
  seeda. Tenant jest jednorazowy, więc nie ma czego przywracać i test nie psuje
  innych przypadków.
- Izolacja: spec nie czyta ani nie zapisuje globalnych ustawień admina, flag
  funkcji, planów, statystyk platformy ani wierszy singletonowych; nie dotyka
  innego tenanta.

## Observed during the suite walk (shared app 3010 / DB 54421, pl)

- `POST /api/v1/auth/password/reset` zwraca **200**, a formularz zastępuje alert
  „Instrukcje zostały wysłane. Sprawdź swoją skrzynkę e-mail.”. W skrzynce jest
  dokładnie 1 wiadomość; link prowadzi na `/password/update` przez
  `/auth/callback?token_hash=…&type=recovery`.
- Formularz `/password/update` nie prosi o obecne hasło (sesja odzyskiwania z OTP
  ją autoryzuje) i ma etykiety „Nowe hasło” / „Potwierdź nowe hasło”.
- Niezgodne potwierdzenie pokazuje przy polu komunikat „Podane hasła nie są
  identyczne.”, nie wysyła skutecznego zapisu i nie zmienia hasła.
- Poprawny zapis: **200** z `POST /api/v1/auth/password/update`, toast „Hasło
  zostało zmienione. Witaj z powrotem!” (przeżywa nawigację kliencką) i
  przekierowanie na `/app` („Cześć, …”).
- Po wylogowaniu nowe hasło loguje (**200** → `/app`), stare jest odrzucane
  (**401**, `x-error-code: UNAUTHORIZED`, toast „Nieprawidłowy adres e-mail lub
  hasło.”, brak sesji).
- Ścieżka regresji bezpieczeństwa: zwykła sesja z logowania hasłem nie może
  zmienić hasła bez `currentPassword` — `POST /api/v1/auth/password/update` z samym
  `password`/`confirmPassword` zwraca **400** `BAD_REQUEST`.
