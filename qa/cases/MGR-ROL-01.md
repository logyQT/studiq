# MGR-ROL-01 — Tworzenie roli – plan bez role.builder (Launch)

- id: MGR-ROL-01
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Role (/manage/roles)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

M1, WSB Merito (Launch).

## Steps

1. Kliknij „Nowa rola”, nazwa „Asystent”, opis; zapisz.

## Expected result

- Operacja odrzucona (403 – brak funkcji role.builder na planie Launch); toast „Nie udało się utworzyć roli”. Zanotuj: czy UI informuje o konieczności zmiany planu (UWAGA: strona nie wyświetla blokady z góry, jak w Ustawieniach).

## Prerequisite context (tenant model)

Wymaganie wstępne „M1, WSB Merito (Launch)” opisuje ręczny seed, na którym pisano
scenariusz. Zautomatyzowany wariant używa własnego tenanta tego przypadku:

```bash
bun scripts/qa-tenant.ts MGR-ROL-01 --fresh   # nowa organizacja i użytkownicy na każdy przebieg
```

- **Klucz tenanta**: `tenantKey('qa/cases/MGR-ROL-01.md', <title>, 'qa-shared')` — z
  `--fresh` tytuł dostaje sufiks przebiegu, więc każdy niezależny przebieg ma nowe,
  ale wciąż deterministyczne id (`tenantId(key, entity)`).
- **Organizacja**: jedna organizacja tworzona przez trigger na planie **Launch**
  (`organizations.plan`); nie ruszamy globalnego katalogu planów ani flag.
- **Użytkownicy** (hasło `Seed4Test!`): `manager` (manager, rola org `admin`) — tylko
  on jest potrzebny; `teacher` i `student` dopełniają graf tenantа.
- **Profil**: `content` (domyślny, więc bez wpisu w `qa/tests/profiles.json`).
- Plan i uprawnienia są odczytywane w tym samym przebiegu przez `/api/v1/me/plan`,
  `/api/v1/features/me` i `/api/v1/subscription-plans` — nic nie jest zaszyte na sztywno.

## Walk observations (shared app, pl)

- Strona `/manage/roles` **wyświetla blokadę z góry**: karta „Kreator ról nie jest
  dostępny w Twoim planie” z opisem „Twój obecny plan nie obejmuje kreatora ról. Ulepsz
  plan, aby tworzyć własne role i uprawnienia.” i przyciskiem „Zobacz plany”.
- „Nowa rola” oraz kolumna „Akcje” **nie są renderowane** na planie Launch, więc
  ścieżka z formularzem i toastem „Nie udało się utworzyć roli” jest nieosiągalna z UI.
  To naprawa #259 (wcześniej strona nie ostrzegała z góry) — intencją jest blokada
  zapisu z wyprzedzeniem plus nadal działająca bramka API.
- Bezpośrednie `POST /api/v1/organization/roles` (nazwa „Asystent”, opis) zwraca
  **403** `{"success":false,"error":"FORBIDDEN"}` i nie tworzy roli; `PUT` istniejącej
  roli jest odrzucany tak samo, a nazwa roli pozostaje bez zmian.
- Lista ról (`admin`, `teacher`, `member`) pozostaje czytelna — blokada dotyczy tylko zapisu.
- „Zobacz plany” prowadzi do `/pricing/org` („Wybierz Swój Plan”): karta bieżącego planu
  oznaczona „Obecny Plan”, a plany z funkcją „Kreator Ról” są na liście. UI **informuje**
  więc o konieczności zmiany planu — to odpowiedź na uwagę z oczekiwanego rezultatu.
