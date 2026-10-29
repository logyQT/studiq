# ONB-05 — Student bez organizacji (S3)

- id: ONB-05
- priority: P2 ważny
- module: ONB – Onboarding, organizacje i zaproszenia
- section: Student – dołączenie do klasy, przełączanie organizacji
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany student3@dev.local.

## Steps

1. Sprawdź górę paska bocznego (przełącznik organizacji).
2. Rozwiń go.

## Expected result

- Student może korzystać z panelu /app bez organizacji (brak wymuszonego onboardingu).
- Przełącznik pokazuje „StudiQ / Student”; po rozwinięciu „Nie należysz do żadnej organizacji” i opcję „Dołącz do klasy”.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`student3@dev.local`, `pass`).
Przypadek wymaga studenta **bez organizacji** — konta samodzielnego (B2C). Tenant
`bare` z rolą `student` to jedno takie konto, bez organizacji i bez grupy:

```bash
bun scripts/qa-tenant.ts ONB-05 --profile bare --role student --fresh
```

- Klucz tenanta: `ONB-05.md::ONB-05#<run>::qa-shared` —
  `tenantKey('qa/cases/ONB-05.md', 'ONB-05#<run>', 'qa-shared')` + `tenantId`, ten sam
  schemat co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, więc każde
  niezależne uruchomienie dostaje własne konto; identyfikatory są deterministyczne
  w obrębie przebiegu (bez losowych UUID).
- Konto: `seed-student-<hash>@dev.local` / `Seed4Test!`, `app_metadata.account_type = student`,
  **zero** wierszy `org_members`, grup i treści.
- Worker QA-suite seeduje **wspólną** bazę (`http://localhost:54421`); `scripts/qa-tenant.ts`
  bierze URL z `qa/env.json`, a klucz service role z `apps/web/.env`.
- Spec: `__tests__/qa/ONB/ONB-05.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl` (kopie interfejsu w przypadku są polskie).
- Izolacja: tenant nie posiada organizacji, grupy, talii, banku ani quizu; spec tylko
  czyta (`GET /api/v1/me/orgs`, nawigacje i jedno rozwinięcie menu). Nie dotyka innego
  tenanta, flag funkcji, planów ani wierszy singletonowych.

## Observed during the suite walk (qa-env-5, shared app 3010 / DB 54421)

- Logowanie przez `/login` kontem studenta bez organizacji kończy się na **`/app`**:
  panel studenta renderuje się (`<h1>` „Cześć, …”, breadcrumb „Moja Nauka”, sekcje
  paska bocznego Główne / Nauka / Treści / Statystyki) i nic nie przekierowuje na
  `/setup` — strażnik onboardingu dotyczy tylko kont `educator`/`manager`. Odświeżenie
  `/app` również zostaje na `/app`. `GET /api/v1/me/orgs` zwraca `[]`, a
  `/api/v1/stats/student/overview`, `/api/v1/assignments` i `/api/v1/features/me`
  odpowiadają `200` dla konta bez organizacji.
- Góra paska bocznego to przełącznik organizacji w stanie samodzielnym: „StudiQ”
  z wierszem roli „Student” pod spodem (brak nazwy organizacji i awatara).
- Rozwinięcie otwiera menu z wyszarzoną etykietą „Nie należysz do żadnej
  organizacji”, separatorem i jedną pozycją: „Dołącz do klasy”.
- „Dołącz do klasy” prowadzi do `/app/join`, gdzie widać kartę „Dołącz do klasy”:
  pole „Kod zaproszenia” (placeholder „Wklej kod lub link zaproszenia”) i przycisk
  „Dołącz”, nieaktywny przy pustym polu. Na tej stronie przełącznik nadal pokazuje
  „StudiQ / Student”.
