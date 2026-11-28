# MGR-SEAT-03 — Zwolnienie miejsca

- id: MGR-SEAT-03
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Licencje / miejsca (/manage/seats)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Amendment (2026-11-26, B2 #1493)

Seats were frozen at the UI: `/manage/seats` kept the pools and assignments tables and every
`GET`, and hid the purchase, assign and release entries. **#1511 restores the release action** (the
trash icon next to an assignment) and the assign entry; the purchase stays deferred. The spec
drives the release through the product API (`DELETE
/api/v1/organization/seats/assignments/<id>`, the same request the button sends), and the page is
reloaded to read the persisted counters. The case's subject — the member falls back to their
personal plan and the pool's available counter grows — is unchanged.

## Amendment (2026-11-28, #1511)

A seat pool is a licence (`ai_lite` / `ai_pro` / `ai_max`); the case buys **`ai_max`**. A licence
seat grants `ai.chat` and its tier quota, and the organization ceiling does not intersect it
(D38), so releasing the seat removes the AI budget and leaves the org/role content alone. The page
resolves the labels from `GET /api/v1/organization/seats/licence-plans`, so the pool and assignment
rows carry the friendly licence name (`StudiQ AI Max`).

## Prerequisite (verbatim)

Istniejący przydział.

## Steps

1. Zwolnij miejsce przez API produktu: `DELETE /api/v1/organization/seats/assignments/<id>`.
2. Odśwież `/manage/seats` i sprawdź liczniki puli.

## Expected result

- Wpis znika z „Przydziałów”; w puli „Przydzielone” maleje o 1, „Dostępne” rośnie o 1.
- Członek wraca do planu bazowego (swojego planu osobistego); drugi przydział zostaje.
- Strona ma przycisk „Przydziel miejsce” i akcję „Zwolnij miejsce” przy przydziale; przycisku
  „Kup miejsca” nie ma (zakup w kolejnym kroku).

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
  `POST /api/v1/organization/seats/pools` (`ai_max`, 2 miejsca — licencja AI, plan
  osobisty bez `audience` od #1193) i dwa `POST /api/v1/organization/seats/assignments`.
  Setup jest idempotentny: powtórzony przebieg w tym samym tenancie czyści własne przydziały i
  ustawia pulę z powrotem na 2 miejsca.
- Kroki 1–2 wykonuje API: `DELETE /api/v1/organization/seats/assignments/<id>` usuwa przydział,
  a odświeżona strona `/manage/seats` (locale `pl`) pokazuje nowe liczniki.
- Weryfikacja „członek wraca do planu bazowego”: `GET /api/v1/me/plan` członka przed
  zwolnieniem zwraca plan miejsca (`ai_max`), a po zwolnieniu jego plan osobisty (`free`) —
  ten sam, który zwraca `GET /api/v1/me/personal-plan`.
- Spec: `__tests__/qa/MGR/MGR-SEAT-03.spec.ts`, projekt `__tests__/qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl`.
- Izolacja: test czyta i zapisuje wyłącznie wiersze swojego tenanta (organizacja,
  członkowie, pule i przydziały miejsc). Etykieta wiersza to przyjazna nazwa licencji z odczytu
  `GET /api/v1/organization/seats/licence-plans`. Test nie dotyka flag funkcji, ustawień admina,
  statystyk platformy ani wierszy singletonowych.

## Walk observations (qa-env-1, shared app :3010 / DB :54421, pl)

- `/manage/seats` ma nagłówek „Licencje miejsc” i dwie karty: „Pule miejsc” (kolumny
  „Plan / Wykupione / Przydzielone / Dostępne”) oraz „Przydziały” (kolumny „Członek /
  Plan / Przydzielone od / Akcje”). W toolbarze jest przycisk „Przydziel miejsce”; przycisku
  „Kup miejsca” nie ma (zakup w kolejnym kroku).
- Wiersz przydziału pokazuje imię i nazwisko członka (nie e-mail), plan miejsca i datę
  `DD.MM.YYYY`; akcja to ikona kosza z `aria-label` „Zwolnij miejsce” — bez okna
  potwierdzenia.
- Po kliknięciu pojawia się toast „Miejsce zwolnione pomyślnie”, wiersz znika z
  „Przydziałów”, a w puli „Przydzielone” maleje o 1, „Dostępne” rośnie o 1 (przy puli
  2/2/0 → 2/1/1). Pula niskich miejsc („Mało”) pozostaje, bo próg to
  `available <= max(1, 20% total)`.
- Zwolnienie miejsca nie usuwa puli ani nie zmienia jej „Wykupione”; drugi przydział w
  tej samej puli zostaje.
- Po zwolnieniu `GET /api/v1/me/plan` zwalnianego członka zwraca `free` (jego plan
  osobisty), a limity wracają do wartości planu bazowego; wcześniej (z przydziałem `max`)
  zwracał `max` z limitami Max (np. `max_flashcards: 25000`). Od #1511 miejsce nie jest
  przecinane z pułapem organizacji (D38): przydział `ai_max` podnosi wyłącznie
  `max_ai_tokens_per_day` (1 000 000), a po zwolnieniu budżet AI wraca do planu osobistego.

## Observed 2026-11-20 (2b-3) — the roster is now declared

The `content` profile's default educator is a real Teacher since 2b-3 (the roster read in
D25 needs an org role that carries `group.manage`/`group.invite`), but this case needs both
seeded people on the org **Member** role: at the time a `max` seat assignment validated the plan `audience` against the
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
`content` profile's educator is an org Teacher again). At that time a `max` seat was
persona-aware and refused an educator account for a student-audience pool (retired by
#1193), so the seat case keeps its
two seated people with the **student** persona and no longer borrows the educator as the
control: the case's profile declares `users.student2` (account type `student`, org
`member`) beside `users.student`, and the spec assigns/releases both `max` seats with that
pair. The roster read (D25) and the plan `audience` are what the `student2` account is
for — the case's own subject (release the seat, the counter moves, the member falls back
to their personal plan) is unchanged.

## Observed 2026-11-22 (4b) — „role-aware” was persona/`audience`

Phase 4b deleted the seats page's role/tier maps (R37): at that time the assign picker
filtered pools by the member's `accountType` against the pool plan's `audience` (the roster
endpoint returns `accountType`), and the purchase picker lists the catalogue's personal
seat-eligible plans. **#1193 retires the persona filter**: the picker offers every pool of
the org, and `assignSeat` accepts any member. No behaviour change for this case's subject:
it buys `max` for two student-persona members and releases one seat.
