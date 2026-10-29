# ONB-02 — Utworzenie klasy (bez zaproszeń)

- id: ONB-02
- priority: P1 krytyczny
- module: ONB – Onboarding, organizacje i zaproszenia
- section: Nauczyciel – konfiguracja klasy
- prereqs: ONB-01
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

ONB-01.

## Prerequisite context

### ONB-01 — Nauczyciel bez organizacji → /setup

_Warunek wstępny: Zalogowany test.teacher01@example.com (bez organizacji)._

1. Po zalogowaniu obserwuj adres.
2. Sprawdź ekran „Witaj w StudiQ”.

Expected:

- Automatyczne przekierowanie na /setup.
- Widoczne dwie opcje: „Dołącz do istniejącej organizacji” i „Utwórz własną klasę”.
- Próba wejścia na /edu przekierowuje z powrotem na /setup.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`test.teacher01@example.com`, `pass`).
Przypadek wymaga nauczyciela **bez organizacji** — czyli stanu pierwszego uruchomienia.
Tenant `bare` to jeden edukator bez organizacji i bez grupy:

```bash
bun scripts/qa-tenant.ts ONB-02 --profile bare --fresh
```

- Klucz tenanta: `ONB-02.md::ONB-02#<run>::qa-shared` —
  `tenantKey('qa/cases/ONB-02.md', 'ONB-02#<run>', 'qa-shared')` + `tenantId`, ten sam schemat
  co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, więc każdy niezależny przebieg
  dostaje nauczyciela, który nigdy nie przeszedł onboardingu; identyfikatory są deterministyczne
  w obrębie przebiegu (bez losowych UUID).
- Konto: `seed-educator-<hash>@dev.local` / `Seed4Test!`, `app_metadata.account_type = educator`,
  **zero** wierszy `org_members`.
- Worker QA-suite seeduje **wspólną** bazę (`http://localhost:54421`); `scripts/qa-tenant.ts`
  bierze URL z `qa/env.json`, a klucz service role z `apps/web/.env`.
- Spec: `__tests__/qa/ONB/ONB-02.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl` (kopie interfejsu w przypadku są polskie).
- Izolacja: po utworzeniu klasy nauczyciel należy tylko do swojej nowej organizacji; test nie
  czyta ani nie zmienia innego tenanta, flag funkcji, planów ani wierszy singletonowych.

## Steps

1. Kliknij „Utwórz własną klasę”.
2. Wpisz nazwę „Moja Klasa” i kliknij „Utwórz klasę”.
3. Kliknij „Przejdź do panelu”.

## Expected result

- Podgląd po prawej pokazuje nazwę oraz „1 członków” z wpisem „Ty (Admin)”.
- Po utworzeniu ekran „Gotowe! Twoja klasa została utworzona.”
- Przejście do /edu; w pasku bocznym przełącznik organizacji pokazuje „Moja Klasa”.

## Observed during the suite walk (qa-env-2, shared app 3010 / DB 54421)

- Logowanie konta bez organizacji: `/edu` najpierw ładuje panel, a następnie klient
  przekierowuje na `/setup`; adres końcowy to `/setup`. Wejście na `/edu` z tej samej sesji
  wraca na `/setup`. `<html lang="pl">`.
- `/setup`: nagłówek „Witaj w StudiQ”, opis „Skonfiguruj swoją klasę, aby rozpocząć.”,
  dwa przyciski: „Dołącz do istniejącej organizacji” i „Utwórz własną klasę”.
- `/setup/classroom`: h1 „Skonfiguruj swoją klasę”, pole „Nazwa klasy” (placeholder
  „Moja Klasa”), opcjonalna sekcja „Zaproś członków”, przycisk „Utwórz klasę”. Podgląd po
  prawej: „Podgląd klasy”, nazwa, „1 członków”, „Ty” i „(Admin)”.
- „Utwórz klasę” → `POST /api/v1/organization` **201**; ekran „Gotowe!” / „Twoja klasa
  została utworzona.” z przyciskiem „Przejdź do panelu”.
- „Przejdź do panelu” → **`/edu`** (brak powrotu na `/setup`; regresja #305 jest zamknięta).
  Pasek boczny pokazuje nazwę klasy i rolę „Admin”; `GET /api/v1/me/orgs` zwraca dokładnie
  jedną organizację z `orgRoleName: "admin"` i `isActive: true`.
