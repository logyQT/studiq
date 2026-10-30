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

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`student1@dev.local`, `pass`) ani
adresu `test.student01@example.com` z dokumentu. Rejestracja tworzy **nowe** konto,
więc tenant dostarcza wyłącznie deterministyczny klucz i świeży sufiks przebiegu;
adres rejestrowany jest z niego wyliczany:

```bash
bun scripts/qa-tenant.ts AUT-01 --profile bare --role student --fresh
```

- Klucz tenanta: `AUT-01.md::AUT-01#<run>::qa-shared` —
  `tenantKey('qa/cases/AUT-01.md', 'AUT-01#<run>', 'qa-shared')` + `shortHash`, ten sam
  schemat co fixture'y e2e (bez nowego schematu ID).
- Rejestrowany adres: `qa+<shortHash(tenant.key)>@test.local`, hasło `Haslo1234`.
  `--fresh` gwarantuje, że adres nie był jeszcze zarejestrowany, a każde niezależne
  uruchomienie dostaje własny, deterministyczny adres.
- Profil `bare`/`student` nie tworzy organizacji ani grup — nowe konto studenta
  również ich nie ma, więc po aktywacji panel `/app` jest właściwym miejscem.
- Skrzynka: Mailpit wspólnego stacka (`http://localhost:54424`), wiadomość
  „StudiQ - Confirm Your Email”; spec czyta wyłącznie pocztę zaadresowaną na własny
  adres tenanta.
- Izolacja: spec nie czyta ani nie zapisuje globalnych ustawień admina, flag funkcji,
  planów, statystyk platformy ani wierszy singletonowych; nie dotyka innego tenanta.

## Observed during the suite walk (qa-env-1, shared app 3010 / DB 54421)

- `/register` renderuje kartę „Utwórz konto” z polami „Imię i Nazwisko”, „Adres
  e-mail”, „Jestem” („Uczniem” / „Nauczycielem” / „Menedżerem”) i „Hasło” oraz
  przyciskiem „Zarejestruj się”; po wylogowaniu strona nie przekierowuje.
- `POST /api/v1/auth/register` zwraca **202** i karta zmienia się w stan sukcesu:
  „Konto zostało utworzone”, „Prawie gotowe! Brakuje jeszcze tylko jednego kroku.”,
  zielony alert „Link aktywacyjny został wysłany. Sprawdź swoją skrzynkę e-mail.”,
  instrukcja aktywacji i przycisk-link „Przejdź do logowania” (`/login`). Formularz
  znika.
- W skrzynce jest dokładnie **1** wiadomość „StudiQ - Confirm Your Email” z linkiem
  `http://localhost:3010/auth/callback?token_hash=…&type=signup&next=/login`.
- Otwarcie linku loguje użytkownika i przekierowuje na **`/app`** (panel studenta);
  `GET /api/v1/auth/me` zwraca zarejestrowany adres, brak parametru `error`.
- Po wylogowaniu (`POST /api/v1/auth/logout`) formularz `/login` („Witaj ponownie”,
  „Adres e-mail”, „Hasło”, „Zaloguj się”) przyjmuje dane z rejestracji i kończy na
  `/app` z nagłówkiem „Cześć, …”.
