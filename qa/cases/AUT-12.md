# AUT-12 — Zapomniane hasło – wysłanie linku

- id: AUT-12
- priority: P1 krytyczny
- module: AUT – Uwierzytelnianie i sesja
- section: Reset hasła, wylogowanie, sesja
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Otwórz /password/reset.
2. Wpisz student1@dev.local i kliknij „Wyślij link”.
3. Otwórz Inbucket.

## Expected result

- Komunikat „Instrukcje zostały wysłane. Sprawdź swoją skrzynkę e-mail.”
- W Inbucket jest wiadomość z linkiem resetującym.

## Suite seed — model tenanta (uzgodnione)

Scenariusz powstał na ręcznym seedzie (`student1@dev.local`). Wersja suite potrzebuje
jednego istniejącego, potwierdzonego konta studenta i braku sesji — dokładnie taki
kształt daje profil `bare`/`student`:

- Tenant przypadku (deterministyczny):
  `tenantKey('qa/cases/AUT-12.md', 'AUT-12#<run>', 'qa-shared')`
  → `AUT-12.md::AUT-12#<run>::qa-shared`
- Seed: `bun scripts/qa-tenant.ts AUT-12 --profile bare --role student --fresh`
  na wspólnym Supabase. Profil `bare` tworzy konto studenta bez organizacji i grup
  (`seed-student-<hash>@dev.local`, hasło `Seed4Test!`), potwierdzone e-mailem przez
  Admin API. `--fresh` dokłada do klucza sufiks uruchomienia, więc każde niezależne
  uruchomienie ma nowy, deterministyczny adres, który nie koliduje z poprzednim ani
  z innym przypadkiem.
- Spec: `__tests__/qa/AUT/AUT-12.spec.ts` (projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`), czyta tenanta z `qa/.tenants/AUT-12.json` i nie tworzy
  kont sam. `__tests__/qa/profiles/AUT-12.json` deklaruje `{ "profile": "bare", "role": "student" }`,
  więc seed w CI wystarcza bez dodatkowych flag.
- Skrzynka: Mailpit wspólnego stacka (`http://localhost:54424`); fixture
  `qa/fixtures/qa-mail.ts` obsługuje też klasyczny Inbucket. Spec czyta wyłącznie
  wiadomości zaadresowane na własny adres tenanta.
- Izolacja: brak sesji, żadnych globalnych ustawień, flag funkcji, planów, statystyk
  platformy ani wierszy singletonowych.

## Observed during the suite walk (qa-env-5, shared app 3010 / DB 54421)

- `/password/reset` jest publiczna i po wylogowaniu nie przekierowuje. Karta:
  „Zapomniałeś hasła?”, „Podaj swój adres e-mail, a wyślemy Ci link do zresetowania
  hasła.”, pole „E-mail” (placeholder `twoj@email.com`), przycisk „Wyślij link” i
  link „Wróć do logowania”.
- `POST /api/v1/auth/password/reset` zwraca **200**
  `{"success":true,"data":{"message":"SUCCESS_PASSWORD_RESET_REQUESTED"}}`. Formularz
  znika, pojawia się zielony alert „Instrukcje zostały wysłane. Sprawdź swoją
  skrzynkę e-mail.” oraz przycisk-link „Wróć do logowania” (`/login`). Widok pozostaje
  na `/password/reset`.
- Żądanie linku nie tworzy sesji (`GET /api/v1/auth/me` → `user: null`) i nie zmienia
  hasła: logowanie seeded hasłem `Seed4Test!` nadal zwraca 200 i to samo konto.
- W skrzynce jest wiadomość „StudiQ - Password Reset” zaadresowana na adres tenanta,
  z linkiem
  `http://localhost:3010/auth/callback?token_hash=…&type=recovery&next=/password/update`.
- Adres, którego nie ma w bazie, dostaje **identyczną** odpowiedź 200 i ten sam
  komunikat sukcesu (brak enumeracji kont); poczta nie jest wysyłana. To zachowanie
  jest zamierzone i spec je utrwala jako ścieżkę regresyjną.
