# MGR-SEAT-03 — Zwolnienie miejsca

- id: MGR-SEAT-03
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Licencje / miejsca (/manage/seats)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Istniejący przydział.

## Steps

1. Zwolnij miejsce przyciskiem przy przydziale.

## Expected result

- Toast „Miejsce zwolnione pomyślnie”; członek wraca do planu bazowego; licznik dostępnych rośnie.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`manager@dev.local`, `pass`). Przypadek
wymaga organizacji z managerem i **dwoma członkami**, z których jeden ma przydzielone
miejsce (kontrola izolacji: drugi przydział nie może zniknąć):

```bash
bun scripts/qa-tenant.ts MGR-SEAT-03 --fresh
```

- Mapowanie: manager → `users.manager` (rola org `admin`), zwalniany członek →
  `users.student` (rola org `member`), przydział-kontrola → `users.teacher` (profil
  `content` nadaje mu rolę org `member`).
- Klucz tenanta: `MGR-SEAT-03.md::MGR-SEAT-03#<run>::qa-shared` —
  `tenantKey('qa/cases/MGR-SEAT-03.md', 'MGR-SEAT-03#<run>', 'qa-shared')` + `tenantId`, ten
  sam schemat co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, więc każdy
  niezależny przebieg dostaje świeżą organizację; identyfikatory są deterministyczne w
  obrębie przebiegu (bez losowych UUID).
- Świeża organizacja nie ma **żadnych puli miejsc** (`plan_seat_allocations` zostało
  usunięte migracją `20260915000003`), więc warunek „istniejący przydział” spec buduje
  przez API produktu — te same żądania, które wysyła okno „Przydziel miejsce”:
  `POST /api/v1/organization/seats/pools` (`pro`, 2 miejsca — plan studencki pasujący do
  roli org `member`) i dwa `POST /api/v1/organization/seats/assignments`. Setup jest
  idempotentny: powtórzony przebieg w tym samym tenancie czyści własne przydziały i
  ustawia pulę z powrotem na 2 miejsca.
- Kroki 1 wykonuje UI: przycisk „Zwolnij miejsce” (`aria-label`) w wierszu przydziału na
  `/manage/seats`, locale `pl`.
- Weryfikacja „członek wraca do planu bazowego”: `GET /api/v1/me/plan` członka przed
  zwolnieniem zwraca plan miejsca (`pro`), a po zwolnieniu jego plan osobisty (`base`) —
  ten sam, który zwraca `GET /api/v1/me/personal-plan`.
- Spec: `__tests__/qa/MGR/MGR-SEAT-03.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl`.
- Izolacja: test czyta i zapisuje wyłącznie wiersze swojego tenanta (organizacja,
  członkowie, pule i przydziały miejsc). Katalog planów jest tylko czytany (nazwa planu do
  etykiety wiersza); test nie dotyka flag funkcji, ustawień admina, statystyk platformy ani
  wierszy singletonowych.

## Walk observations (qa-env-1, shared app :3010 / DB :54421, pl)

- `/manage/seats` ma nagłówek „Licencje miejsc” i dwie karty: „Pule miejsc” (kolumny
  „Plan / Wykupione / Przydzielone / Dostępne”) oraz „Przydziały” (kolumny „Członek /
  Plan / Przydzielone od / Akcje”). Przyciski w toolbarze: „Kup miejsca” i
  „Przydziel miejsce”.
- Wiersz przydziału pokazuje imię i nazwisko członka (nie e-mail), plan miejsca i datę
  `DD.MM.YYYY`; akcja to ikona kosza z `aria-label` „Zwolnij miejsce” — bez okna
  potwierdzenia.
- Po kliknięciu pojawia się toast „Miejsce zwolnione pomyślnie”, wiersz znika z
  „Przydziałów”, a w puli „Przydzielone” maleje o 1, „Dostępne” rośnie o 1 (przy puli
  2/2/0 → 2/1/1). Pula niskich miejsc („Mało”) pozostaje, bo próg to
  `available <= max(1, 20% total)`.
- Zwolnienie miejsca nie usuwa puli ani nie zmienia jej „Wykupione”; drugi przydział w
  tej samej puli zostaje.
- Po zwolnieniu `GET /api/v1/me/plan` zwalnianego członka zwraca `base` (jego plan
  osobisty), a limity wracają do wartości planu bazowego; wcześniej (z przydziałem `pro`)
  zwracał `pro` z limitami `-1`.
