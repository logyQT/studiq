# MGR-SEAT-01 — Zakup miejsc (symulacja)

- id: MGR-SEAT-01
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Licencje / miejsca (/manage/seats)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Amendment (2026-11-26, B2 #1493)

Seats were frozen at the UI: `/manage/seats` kept the pools and assignments tables and every
`GET`, and hid the purchase, assign and release entries. **#1511 restores the assign and release
entries**; the purchase entry stays deferred to a later slice. The purchase is driven through the
product API, the same `POST` the dialog will send; a fresh organization still starts without
pools, so the pool the case reads back is the one it bought.

## Amendment (2026-11-28, #1511)

A seat pool is a licence now. `POST /api/v1/organization/seats/pools` accepts a plan that is
`scope='personal'`, sold on the `seat_pool` channel and carries only `seatEligible` keys, so the
three AI tiers (`ai_lite` / `ai_pro` / `ai_max`) are the only plans it takes; any individual plan
answers **422**. The case buys **`ai_lite`** ×3. A licence is AI only: `ai.chat` and a daily quota,
with no content limit and no non-AI feature.

The page shows the three licence tier cards and resolves a pool's label from
`GET /api/v1/organization/seats/licence-plans`, so the pools and assignments rows carry the
friendly licence name (`StudiQ AI Lite`). The purchase control is not on the page yet; the case
buys through the API.

## Prerequisite (verbatim)

M1.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`manager@dev.local`, `pass`). Przypadek
potrzebuje managera organizacji i strony `/manage/seats` — dokładnie to daje tenant
`content`:

```bash
bun scripts/qa-tenant.ts MGR-SEAT-01 --fresh
```

- Klucz tenanta: `MGR-SEAT-01.md::MGR-SEAT-01#<run>::qa-shared` —
  `tenantKey('qa/cases/MGR-SEAT-01.md', 'MGR-SEAT-01#<run>', 'qa-shared')` + `tenantId`, ten
  sam schemat co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, więc każde
  niezależne uruchomienie dostaje świeżą organizację; identyfikatory są deterministyczne
  w obrębie przebiegu (bez losowych UUID).
- Organizacja: `qa-mgr-seat-01-<suffix>` (plan `launch`), grupa domyślna `G1`.
- Członkowie: manager (`admin`, rola org `admin`), nauczyciel i student (rola org
  `member`) — przypadek używa wyłącznie managera.
- Konto managera: `seed-manager-<hash>@dev.local` / `Seed4Test!`,
  `app_metadata.account_type = manager`.
- Świeża organizacja nie ma pul miejsc: domyślne pule z `plan_seat_allocations` zostały
  usunięte migracją `20260915000003_drop_plan_seat_allocations.sql`, więc pula odczytana
  po zakupie jest dokładnie tą, którą kupił test.
- Worker QA-suite seeduje **wspólną** bazę (`http://localhost:54421`); `scripts/qa-tenant.ts`
  bierze URL z `qa/env.json`, a klucz service role z `.env.local`.
- Spec: `__tests__/qa/MGR/MGR-SEAT-01.spec.ts`, projekt `__tests__/qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl` (kopie w przypadku są polskie).
- Izolacja: test czyta i zapisuje wyłącznie pule miejsc (`org_seat_pools`) swojej
  organizacji; nie dotyka katalogu planów, flag funkcji, statystyk platformy ani wierszy
  singletonowych.

## Steps

1. Sprawdź, że strona pokazuje karty trzech licencji AI, obie tabele, przycisk
   „Przydziel miejsce” i akcje „Zwolnij miejsce”; nie ma przycisku „Kup miejsca”.
2. Wykonaj zakup przez API produktu: `POST /api/v1/organization/seats/pools`
   `{"planKey":"ai_lite","quantity":3}`.
3. Spróbuj ilości 0 oraz ujemnej tym samym żądaniem.

## Expected result

- Strona renderuje karty „Licencje AI na miejsca” z ceną za miejsce i dziennym limitem
  tokenów oraz tabele „Pule miejsc” i „Przydziały”; jest przycisk „Przydziel miejsce”
  i akcja „Zwolnij miejsce”, a przycisku „Kup miejsca” nie ma (zakup w kolejnym kroku).
- `POST` zwraca **201**, a pula na liście ma 3 wykupione, 0 przydzielonych, 3 dostępne;
  wiersz nosi przyjazną nazwę licencji „StudiQ AI Lite”.
- `POST` z ilością 0 lub ujemną zwraca **422** `UNPROCESSABLE_ENTITY` i nie tworzy puli.

## Observed during the suite walk (qa-env-8, shared app 3010 / DB 54421)

- `/manage/seats` renderuje nagłówek „Licencje miejsc”, karty trzech licencji AI i dwie karty:
  „Pule miejsc” (kolumny Plan / Wykupione / Przydzielone / Dostępne) oraz „Przydziały”. Świeża
  organizacja pokazuje „Brak skonfigurowanych pul miejsc” i „Nie przydzielono jeszcze
  żadnych miejsc”.
- #1511 przywrócił przycisk „Przydziel miejsce” i akcje „Zwolnij miejsce”; przycisku
  „Kup miejsca” nie ma (zakup w kolejnym kroku). Obie tabele i wszystkie `GET` działają.
- Krok 2 — `POST /api/v1/organization/seats/pools` `{"planKey":"ai_lite","quantity":3}` →
  **201** `{"success":true,...}`. Po odświeżeniu w tabeli jest wiersz „StudiQ AI Lite”
  z wartościami **3 / 0 / 3**. Wartości są liczone po stronie serwera (`total` /
  `assigned`), a „Dostępne” to `total - assigned`.
- Krok 3 — `POST` z `quantity: 0` lub `quantity: -2` → **422**
  `{"success":false,"error":"UNPROCESSABLE_ENTITY"}` i pula pozostaje 3 / 0.
- Po odświeżeniu strony pula nadal ma 3 / 0 / 3 — stan jest trzymany w bazie, nie tylko
  w komponencie.
