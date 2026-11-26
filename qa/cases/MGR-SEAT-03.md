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
  `users.student` (rola org `member`), przydział-kontrola → `users.student2` (rola org
  `member`).
- Klucz tenanta: `MGR-SEAT-03.md::MGR-SEAT-03#<run>::qa-shared` —
  `tenantKey('qa/cases/MGR-SEAT-03.md', 'MGR-SEAT-03#<run>', 'qa-shared')` + `tenantId`, ten
  sam schemat co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, więc każdy
  niezależny przebieg dostaje świeżą organizację; identyfikatory są deterministyczne w
  obrębie przebiegu (bez losowych UUID).
- Świeża organizacja nie ma **żadnych puli miejsc** (`plan_seat_allocations` zostało
  usunięte migracją `20260915000003`), więc warunek „istniejący przydział” spec buduje
  przez API produktu — te same żądania, które wysyła okno „Przydziel miejsce”:
  `POST /api/v1/organization/seats/pools` (`pro`, 2 miejsca — plan osobisty bez
  `audience` od #1193) i dwa `POST /api/v1/organization/seats/assignments`. Setup jest
  idempotentny: powtórzony przebieg w tym samym tenancie czyści własne przydziały i
  ustawia pulę z powrotem na 2 miejsca.
- Kroki 1 wykonuje UI: przycisk „Zwolnij miejsce” (`aria-label`) w wierszu przydziału na
  `/manage/seats`, locale `pl`.
- Weryfikacja „członek wraca do planu bazowego”: `GET /api/v1/me/plan` członka przed
  zwolnieniem zwraca plan miejsca (`pro`), a po zwolnieniu jego plan osobisty (`base`) —
  ten sam, który zwraca `GET /api/v1/me/personal-plan`.
- Spec: `__tests__/qa/MGR/MGR-SEAT-03.spec.ts`, projekt `__tests__/qa/playwright.qa.config.ts`, baseURL
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
  zwracał `pro` z limitami Max (np. `max_flashcards: 25000`).

## Observed 2026-11-20 (2b-3) — the roster is now declared

The `content` profile's default educator is a real Teacher since 2b-3 (the roster read in
D25 needs an org role that carries `group.manage`/`group.invite`), but this case needs both
seeded people on the org **Member** role: at the time a `pro` seat assignment validated the plan `audience` against the
account's persona (D33; retired by #1193) and refused an educator or manager account,
and the spec asserts `accountType === 'student'` (and `orgRoleName === 'member'`) for
`users.student` and `users.teacher` before it buys the pool. The spec now fails on the
default (the untested control account is no longer a member), so the case declares its own
roster: `__tests__/qa/profiles/MGR-SEAT-03.json` — the case had none — declares the same
`"profile": "content"` the default implied and adds `members` (manager `admin`, educator
`member`, student `member`), the same keys, account types, names, ids and e-mails the
default produced. No `plan` field: the case buys its own seat pool. Assertions and steps
untouched.

## Observed 2026-11-22 (3d) — the second seat holder is a student

D29 moves the Teacher role's content reads to `group`, retiring the 2b-3 workaround (the
`content` profile's educator is an org Teacher again). At that time a `pro` seat was
persona-aware and refused an educator account for a student-audience pool (retired by
#1193), so the seat case keeps its
two seated people with the **student** persona and no longer borrows the educator as the
control: the case's profile declares `users.student2` (account type `student`, org
`member`) beside `users.student`, and the spec assigns/releases both `pro` seats with that
pair. The roster read (D25) and the plan `audience` are what the `student2` account is
for — the case's own subject (release the seat, the counter moves, the member falls back
to their personal plan) is unchanged.

## Observed 2026-11-22 (4b) — „role-aware” was persona/`audience`

Phase 4b deleted the seats page's role/tier maps (R37): at that time the assign picker
filtered pools by the member's `accountType` against the pool plan's `audience` (the roster
endpoint returns `accountType`), and the purchase picker lists the catalogue's personal
seat-eligible plans. **#1193 retires the persona filter**: the picker offers every pool of
the org, and `assignSeat` accepts any member. No behaviour change for this case's subject:
it buys `pro` for two student-persona members and releases one seat.
