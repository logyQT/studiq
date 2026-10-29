# MGR-SEAT-01 — Zakup miejsc (symulacja)

- id: MGR-SEAT-01
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Licencje / miejsca (/manage/seats)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

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
  bierze URL z `qa/env.json`, a klucz service role z `apps/web/.env`.
- Spec: `__tests__/qa/MGR/MGR-SEAT-01.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl` (kopie w przypadku są polskie).
- Izolacja: test czyta i zapisuje wyłącznie pule miejsc (`org_seat_pools`) swojej
  organizacji; nie dotyka katalogu planów, flag funkcji, statystyk platformy ani wierszy
  singletonowych.

## Steps

1. Kliknij „Kup miejsca”, wybierz plan i ilość 3, kliknij „Kup”.
2. Spróbuj ilości 0 oraz ujemnej.

## Expected result

- Toast „Miejsca dodane do puli”; pula na liście ma 3 wykupione, 0 przydzielonych, 3 dostępne.
- Przycisk „Kup” jest nieaktywny bez planu lub przy ilości < 1.

## Observed during the suite walk (qa-env-8, shared app 3010 / DB 54421)

- `/manage/seats` renderuje nagłówek „Licencje miejsc” i dwie karty: „Pule miejsc”
  (kolumny Plan / Wykupione / Przydzielone / Dostępne) oraz „Przydziały”. Świeża
  organizacja pokazuje „Brak skonfigurowanych pul miejsc” i „Nie przydzielono jeszcze
  żadnych miejsc”.
- „Kup miejsca” otwiera okno „Kup licencje na miejsca” z listą planów („Wybierz plan”:
  StudiQ Ace / Pro / Creator / Master / Campus), polem „Ilość” (domyślnie `1`) oraz
  przyciskami „Anuluj” / „Kup”. Bez wybranego planu „Kup” jest nieaktywny; przy ilości
  0 lub ujemnej również jest nieaktywny i pod polem pojawia się komunikat „Podaj liczbę
  całkowitą miejsc (co najmniej 1).”. Ilość `1` ponownie aktywuje przycisk.
- Krok 1 — wybór „StudiQ Ace” i ilości `3`, następnie „Kup” wysyła
  `POST /api/v1/organization/seats/pools` `{"planKey":"ace","quantity":3}` → **201**
  `{"success":true,...}`, zamyka okno i pokazuje toast **„Miejsca dodane do puli”**.
  W tabeli pojawia się wiersz „StudiQ Ace” z wartościami **3 / 0 / 3**. Wartości są
  liczone po stronie serwera (`total` / `assigned`), a „Dostępne” to `total - assigned`.
- Krok 2 — dla ilości `0` i `-2` strona nie wysyła żadnego żądania (przycisk jest
  wyłączony); ten sam limit egzekwuje API: `POST` z `quantity: 0` lub `quantity: -2`
  → **422** `{"success":false,"error":"UNPROCESSABLE_ENTITY"}` i pula pozostaje 3 / 0.
- Po odświeżeniu strony pula nadal ma 3 / 0 / 3 — stan jest trzymany w bazie, nie tylko
  w komponencie.
