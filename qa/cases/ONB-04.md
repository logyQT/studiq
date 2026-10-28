# ONB-04 — Manager bez organizacji → /setup/org

- id: ONB-04
- priority: P2 ważny
- module: ONB – Onboarding, organizacje i zaproszenia
- section: Manager – konfiguracja organizacji
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany test.manager01@example.com.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`test.manager01@example.com`, `pass`).
Przypadek wymaga managera **bez organizacji** — czyli stanu pierwszego uruchomienia
panelu `/manage`. Tenant `bare` z rolą `manager` to jedno takie konto, bez organizacji
i bez grupy:

```bash
bun scripts/qa-tenant.ts ONB-04 --profile bare --role manager --fresh
```

- Klucz tenanta: `ONB-04.md::ONB-04#<run>::qa-shared` —
  `tenantKey('qa/cases/ONB-04.md', 'ONB-04#<run>', 'qa-shared')` + `tenantId`, ten sam
  schemat co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, bo **przebieg
  tworzy organizację**: każde niezależne uruchomienie dostaje managera, który nigdy nie
  przeszedł onboardingu. Identyfikatory są deterministyczne w obrębie przebiegu.
- Konto: `seed-manager-<hash>@dev.local` / `Seed4Test!`, `app_metadata.account_type = manager`,
  **zero** wierszy `org_members`.
- Worker QA-suite seeduje **wspólną** bazę (`http://localhost:54421`); `scripts/qa-tenant.ts`
  bierze URL z `qa/env.json`, a klucz service role z `apps/web/.env`.
- Spec: `qa/tests/ONB/ONB-04.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl` (kopie interfejsu w przypadku są polskie).
- Izolacja: test tworzy wyłącznie organizację tego managera i czyta jej role przez
  `/api/v1/organization/roles`. Nie dotyka innego tenanta, flag funkcji, planów ani
  wierszy singletonowych.

## Steps

1. Po zalogowaniu obserwuj adres.
2. Wpisz nazwę organizacji „Test Uczelnia” i kliknij „Utwórz organizację”.

## Expected result

- Przekierowanie na /setup/org z formularzem „Skonfiguruj swoją organizację”.
- Przycisk „Utwórz organizację” nieaktywny przy pustej nazwie.
- Po utworzeniu przejście do /manage; w przełączniku organizacji „Test Uczelnia”, rola „Admin”.
- W bazie istnieją role systemowe organizacji: member, teacher, admin.

## Observed during the suite walk (qa-env-4, shared app 3010 / DB 54421)

- Logowanie przez `/login` z managerem bez organizacji trafia najpierw na `/manage`,
  a strażnik dashboardu (`manage/layout.tsx`, `needsOnboarding`) podmienia adres na
  `/setup/org`. Wejście na `/manage` bezpośrednio kończy się tak samo.
- `/setup/org` renderuje kartę z tytułem `[data-slot="card-title"]` „Skonfiguruj swoją
  organizację”, opis „Utwórz organizację, aby rozpocząć.”, pole „Nazwa organizacji”
  (placeholder „Uniwersytet ...”) i przycisk „Utwórz organizację”.
- Przycisk jest `disabled` dokładnie wtedy, gdy pole jest puste (także po wyczyszczeniu
  wpisanej nazwy); po wpisaniu nazwy staje się aktywny.
- `POST /api/v1/organization` zwraca `201` i organizację o podanej nazwie; ekran
  przechodzi na `/manage`. Przełącznik organizacji w pasku bocznym pokazuje
  „Test Uczelnia” i rolę „Admin”; menu przełącznika zawiera pozycję z tą samą nazwą
  i rolą.
- `GET /api/v1/me/orgs` zwraca dokładnie jedną organizację, aktywną, z rolą
  `orgRoleName: admin`. `GET /api/v1/organization/roles` zwraca trzy role systemowe:
  `admin`, `member`, `teacher` (`isSystem: true`); `admin` ma 1 członka (twórcę).
- Odświeżenie `/manage` po utworzeniu organizacji nie cofa do `/setup/org`.
