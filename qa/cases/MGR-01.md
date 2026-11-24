# MGR-01 — Pulpit „Zarządzanie Uczelnią” (/manage)

- id: MGR-01
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Pulpit managera
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany manager@dev.local, organizacja WSB Merito.

## Seed (tenant model)

Automatyzacja nie używa konta `manager@dev.local` ani organizacji WSB Merito z ręcznego
seeda. Przypadek dostaje własny tenant z profilem `content` — organizację, managera
(admin), wykładowcę i studenta:

```bash
bun scripts/qa-tenant.ts MGR-01 --fresh
```

- Klucz tenanta: `MGR-01.md::MGR-01#<run>::qa-shared` —
  `tenantKey('qa/cases/MGR-01.md', 'MGR-01#<run>', 'qa-shared')` + `tenantId`, ten sam
  schemat co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, więc każde niezależne
  uruchomienie ma własną organizację i własne konta.
- organizacja `qa-mgr-01-<hash>`, grupa `G1`; konta `seed-manager-<hash>@dev.local`,
  `seed-educator-<hash>@dev.local`, `seed-student-<hash>@dev.local` / `Seed4Test!`.
- Profil `content` nadaje kontom **realne role organizacyjne**: manager jest
  `admin` (`entitlement_profile='all'`), wykładowca `teacher` (`all`), student
  `member` (`learner`). Od phase 6b-2 pulpit liczy „Wykładowców”/„Studentów” po
  profilu uprawnień roli, a nie po jej nazwie, więc **żadna promocja roli nie jest
  potrzebna**: zaraz po seedzie liczniki to 3 / 2 / 1.
- Krok 2b przypadku tworzy rolę niestandardową o nazwie innej niż `member` i
  profilu `learner` (`POST /api/v1/organization/roles`) i przypisuje ją
  wykładowcy (`PUT /api/v1/organization/members`) — oba endpointy należą do
  własnej organizacji tenanta, a zapis jest idempotentny.
- Spec: `__tests__/qa/MGR/MGR-01.spec.ts`, projekt `__tests__/qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl` (kopie interfejsu w przypadku są polskie).
- Izolacja: test czyta `/api/v1/organization/members` i `/api/v1/organization/roles`
  własnej organizacji oraz zmienia rolę jej członka. Nie dotyka innego tenanta, flag
  funkcji, planów, statystyk platformy ani wierszy singletonowych.

## Steps

1. Otwórz /manage.
2. Sprawdź karty: Łączna liczba członków, Wykładowcy, Studenci.
3. Kliknij „Zaproś członków” oraz „Zarządzaj członkami”.
4. Sprawdź listę „Ostatni członkowie”.

## Expected result

- Liczniki odpowiadają profilom uprawnień ról członków organizacji (ADR-0015
  §5.3), a nie nazwom ról: **3 łącznie**, w tym **2 wykładowców** (admin i
  wykładowca — oba profile `all`) i **1 student** (profil `learner`).
  Administrator organizacji liczy się do sumy i do „Wykładowców”; nie podnosi
  licznika studentów.
- **Rola niestandardowa z profilem `learner` jest studentem, choćby nazywała się
  inaczej niż `member`.** Po utworzeniu takiej roli przez
  `POST /api/v1/organization/roles`, przypisaniu jej wykładowcy przez
  `PUT /api/v1/organization/members` i odświeżeniu pulpitu liczniki to
  **3 / 1 / 2**: nazwa roli nie decyduje o klasyfikacji, decyduje
  `entitlement_profile`.
- Szybkie akcje prowadzą do /manage/invites i /manage/members.
- Lista „Ostatni członkowie” pokazuje wszystkich członków organizacji (maks. 5,
  najnowsi pierwsi) z ich rolą organizacyjną; stan ładowania („Ładowanie...”) i pusty
  stan („Brak członków”) renderują się bez błędów.

## Observations (walk 2026-10-28, shared app :3010, worker qa-env-7) — klasyfikacja po nazwie roli, nieaktualna od phase 6b-2

Poniższy zapis opisuje pulpit sprzed phase 6b-2, gdy o kartach decydowała nazwa
roli organizacyjnej. Dziś klasyfikuje `org_roles.entitlement_profile`, więc
seeded tenant daje od razu 3 / 2 / 1, a po przeniesieniu wykładowcy na rolę
niestandardową z profilem `learner` — 3 / 1 / 2. Zapis zostaje jako historia
przebiegu.

- Pulpit renderuje trzy karty `StatCard`: „Łączna liczba członków”, „Wykładowcy”,
  „Studenci”. Wartość to akapit obok tytułu karty; w trakcie ładowania zamiast liczby
  jest pulsujący placeholder (nie tekst „...”).
- Po zaseedowaniu (wszyscy na roli `member`) liczniki to 3 / 0 / 2 — wykładowca jest
  liczony jako student, bo o roli decyduje `orgRoleName`, a nie typ konta. Po nadaniu
  wykładowcy roli organizacyjnej `teacher` (przez `/manage/members`) liczniki to
  3 / 1 / 1, czyli dokładnie oczekiwany układ: admin tylko w sumie.
- „Szybkie akcje” to dwa linki z przyciskami: „Zaproś członków” → `/manage/invites`,
  „Zarządzaj członkami” → `/manage/members`. Oba ekrany docelowe renderują się
  (nagłówki „Zaproszenia”, „Członkowie”).
- „Ostatni członkowie” sortuje po `created_at` profilu malejąco i tnie do 5 pozycji;
  każdy wiersz to nazwa (lub e-mail), e-mail pod nazwą i **surowa** nazwa roli
  (`admin` / `teacher` / `member`, bez tłumaczenia). API `/api/v1/organization/members`
  sortuje po `joined_at`, więc kolejność listy nie zawsze równa się kolejności API —
  test porównuje zbiór i role, a kolejność wylicza tym samym komparatorem co karta.
- Pusty stan „Brak członków” jest nieosiągalny przez produkt (manager zawsze jest
  członkiem swojej organizacji), dlatego stan pusty i stan ładowania są sprawdzane na
  podstawionej odpowiedzi `/api/v1/organization/members` (bez zapisu do bazy).
