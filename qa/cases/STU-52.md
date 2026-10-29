# STU-52 — Historia płatności

- id: STU-52
- priority: P3 kosmetyczny
- module: STU – Panel studenta (/app)
- section: Konto studenta (/app/account)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Tenant (QA-suite seed)

- Profil: `{ "profile": "bare", "role": "student" }` (`qa/tests/profiles/STU-52.json`).
- Seed: `bun scripts/qa-tenant.ts STU-52 --fresh` — jedno konto studenta bez organizacji
  i bez grupy, z osobistym planem `base`, który zapisuje trigger `handle_new_user`.
  Wszystkie id pochodzą z
  `tenantKey('qa/cases/STU-52.md', 'STU-52#<suffix>', 'qa-shared')` + `tenantId`.
  Świeży sufiks na każdy niezależny przebieg daje studenta, który nigdy nic nie kupił.
- Konto: `tenant.users.student` (`seed-student-<hash>@dev.local` / `Seed4Test!`) — to jest
  dokładnie warunek „Konto TS” z dokumentu: samodzielne konto studenckie bez zakupów.
- Mapowanie legacy: `test-student@dev.local` (Base, brak organizacji) → student tenanta.
  Żadne konto `@dev.local` ani hasło `pass` nie jest używane.
- Zakup z oczekiwanego rezultatu (BIL-03) jest odwzorowany przez ten sam wywołanie, które
  wykonuje kasa: `POST /api/v1/stripe/webhook` z `type: checkout.session.completed`,
  `plan_id: spark`, `user_id` studenta tenanta. Zmienia wyłącznie
  `profiles.personal_plan_key` tego studenta i dopisuje jeden wiersz w `payments` dla
  tego samego użytkownika.
- `payments` jest append-only (RLS: SELECT tylko własnych wierszy, brak polityki zapisu),
  więc spec przed przejściem przywraca wyłącznie własny stan tenanta — usuwa wiersze
  `payments` swojego studenta i ustawia jego plan na `base`. Dzięki temu retry w CI
  (`--retries=2`) na tym samym seedzie startuje jak świeży seed, a nie z zakupem
  poprzedniej próby.
- Izolacja: spec czyta i zapisuje tylko własnego studenta. Nie dotyka innego tenanta,
  ustawień admina, flag funkcji, katalogu planów, statystyk platformy ani wierszy
  singletonowych.

## Prerequisite (verbatim)

Konto TS.

## Steps

1. Otwórz /app/account/payments.

## Expected result

- Tytuł „Historia płatności” i komunikat „Brak płatności” (dla konta bez zakupów); po zakupie planu (BIL-03) – zanotuj, czy pojawia się wpis.

## Obserwacje (walk na współdzielonej aplikacji, 2026-10-29)

- Konto bez zakupów (`bare`/`student`, plan Base): `/app/account/payments` renderuje tytuł
  „Historia płatności”, podtytuł „Twoje zakończone płatności”, kartę „Historia płatności”
  z komunikatem „Brak płatności” i przycisk „Zarządzaj rozliczeniami”; tabeli nie ma.
  `GET /api/v1/me/payments` zwraca `{"success":true,"data":[]}`.
- „Zarządzaj rozliczeniami” prowadzi do `/app/billing`. Powrót na `/app/account/payments`
  nadal pokazuje „Brak płatności” — pusty stan nie jest cache'owany po zakupie.
- Po zakupie Spark (9,99 zł/mies., karta testowa `4242…`) strona pokazuje tabelę
  „Plan / Kwota / Data” z jednym wierszem: „StudiQ Spark”, „9,99 zł”, „29 paź 2026”
  (data `paid_at` sformatowana `Intl.DateTimeFormat('pl', { dateStyle: 'medium' })`).
  Komunikat „Brak płatności” znika. `GET /api/v1/me/payments` zwraca ten sam wiersz
  (`planKey: "spark"`, `planName: "StudiQ Spark"`, `amount: 999`, `currency: "PLN"`).
- Wpis pojawia się po zakupie, więc punkt „zanotuj, czy pojawia się wpis” jest spełniony
  (poprawka #392); to zachowanie jest asertowane w specu, a nie tylko odnotowane.
- Wejście anonimowe na `/app/account/payments` przekierowuje do
  `/login?next=%2Fapp%2Faccount%2Fpayments`, a `GET /api/v1/me/payments` bez sesji
  odpowiada `401` z `{"success":false,"error":"UNAUTHORIZED"}`.
