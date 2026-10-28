# AUT-06 — Brak aktywacji konta uniemożliwia logowanie

- id: AUT-06
- priority: P2 ważny
- module: AUT – Uwierzytelnianie i sesja
- section: Rejestracja
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Świeżo zarejestrowane konto, link nieużyty.

## Steps

1. Zarejestruj test.unconfirmed@example.com (nie klikaj linku).
2. Spróbuj się zalogować tym kontem.

## Expected result

- Logowanie jest odrzucone z czytelnym komunikatem (np. „Logowanie nie powiodło się…” lub o niepotwierdzonym e-mailu).
- Użytkownik nie otrzymuje sesji.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda ani adresu
`test.unconfirmed@example.com` z dokumentu. Rejestracja tworzy **nowe** konto, więc
tenant dostarcza wyłącznie deterministyczny klucz i świeży sufiks przebiegu:

```bash
bun scripts/qa-tenant.ts AUT-06 --profile bare --role student --fresh
```

- Klucz tenanta: `AUT-06.md::AUT-06#<run>::qa-shared` —
  `tenantKey('qa/cases/AUT-06.md', 'AUT-06#<run>', 'qa-shared')` + `shortHash`, ten sam
  schemat co fixture'y e2e (bez nowego schematu ID).
- Rejestrowany adres: `qa+<shortHash(tenant.key)>+aut06@test.local`, hasło
  `Seed4Test!`. `--fresh` gwarantuje, że adres nie był jeszcze zarejestrowany, a
  każde niezależne uruchomienie dostaje własny, deterministyczny adres.
- Konto tenanta (`bare`/`student`, `email_confirm: true`) jest **potwierdzonym**
  kontem kontrolnym ścieżki regresji: ten sam formularz `/login` musi je wpuścić i
  ustanowić sesję, więc odrzucenie dotyczy wyłącznie konta bez aktywacji, a nie
  logowania w ogóle.
- Skrzynka: Mailpit wspólnego stacka (`http://localhost:54424`), wiadomość
  „StudiQ - Confirm Your Email”; spec czyta wyłącznie pocztę zaadresowaną na własny
  adres tenanta i **nie otwiera** linku aktywacyjnego.
- Izolacja: spec nie czyta ani nie zapisuje globalnych ustawień admina, flag
  funkcji, planów, statystyk platformy ani wierszy singletonowych; nie dotyka
  innego tenanta.

## Observed during the suite walk (shared app 3010 / DB 54421, pl)

- `POST /api/v1/auth/register` zwraca **202**, karta rejestracji zmienia się w stan
  „Konto zostało utworzone” / „Link aktywacyjny został wysłany…”, a rejestracja
  **nie** ustanawia sesji (`GET /api/v1/auth/me` → `user: null`).
- W skrzynce jest dokładnie 1 wiadomość z linkiem
  `/auth/callback?token_hash=…&type=signup`; link pozostaje nieużyty.
- Logowanie tym samym adresem i hasłem przez `/login` kończy się **401**
  (`x-error-code: UNAUTHORIZED`, body `{"success":false,"error":"UNAUTHORIZED"}`),
  toastem „Nieprawidłowy adres e-mail lub hasło.” i brakiem ciasteczka sesji
  (`sb-*-auth-token`). Strona pozostaje na `/login`; wejście na `/app` przekierowuje
  na `/login?next=%2Fapp`, a `GET /api/v1/auth/me` nadal zwraca `user: null`.
- Komunikat jest celowo ogólny: `AuthService.login()` mapuje każdy błąd GoTrue
  (w tym `email_not_confirmed`) na `UNAUTHORIZED`, żeby nie ujawniać istnienia konta
  (brak enumeracji). Dokument dopuszcza ogólne brzmienie („np. Logowanie nie
  powiodło się…”), więc oczekiwane zachowanie to czytelny komunikat + brak sesji, a
  nie tekst wprost o niepotwierdzonym e-mailu.
- Ścieżka regresji: potwierdzone konto studenta z tenanta loguje się tym samym
  formularzem, dostaje **200**, ciasteczko sesji i przekierowanie na `/app`
  („Cześć, …”).
