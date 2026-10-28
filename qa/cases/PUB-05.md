# PUB-05 — Strona Kontakt (/contact)

- id: PUB-05
- priority: P3 kosmetyczny
- module: PUB – Strony publiczne i nawigacja ogólna
- section: Funkcje, Cennik, Kontakt, strony prawne
- prereqs: none (public route, no session)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Seed (tenant model, reconciled)

The case was generated against the legacy manual seed, but its prerequisite is
"no session": `/contact` is public marketing copy, so the suite version needs no
tenant user, content id or organisation — only the shared app and a fresh browser
context (empty cookie jar).

- Case tenant (deterministic, bookkeeping only):
  `tenantKey('qa/cases/PUB-05.md', 'PUB-05', 'qa-shared')` →
  `PUB-05.md::PUB-05::qa-shared`; the seeder's default `content` profile.
- Profile: `qa/tests/profiles/PUB-05.json` (`"content"`), so
  `bun scripts/qa-tenant.ts PUB-05` creates org `qa-pub-05-shared` with
  manager/teacher/student (`Seed4Test!`) and group `G1`.
- Each independent run uses a fresh suffix:
  `bun scripts/qa-tenant.ts PUB-05 --fresh` → `PUB-05#<suffix>` tenant and
  `qa-pub-05-<suffix>` org. The spec consumes none of those rows; the tenant
  exists so the case has a deterministic, isolated identity like every other
  suite test.
- Spec: `qa/tests/PUB/PUB-05.spec.ts`, runner `qa/playwright.qa.config.ts`,
  baseURL `http://localhost:3010`.
- Isolation: `storageState: { cookies: [], origins: [] }` plus an explicit
  `NEXT_LOCALE=pl`; nothing shared (plans, flags, settings, platform stats) is
  read or written.

## Steps

1. Otwórz /contact.

## Expected result

- Sekcje: Sprzedaż, Inspektor Ochrony Danych, Kariera, Wsparcie, Siedziba (StudiQ sp. z o.o., adres, NIP, KRS).
- Brak błędów, treść po polsku.

## Observations (walk, 2026-10-28, shared app :3010, QA worker qa-env-2)

- `/contact` returns 200 without a session (`GET /api/v1/auth/me` → `user: null`),
  `<html lang="pl">`, title „Kontakt | StudiQ” (the #290 generic-title regression
  is fixed).
- H1 „Kontakt” + lead „Skontaktuj się z odpowiednim zespołem”.
- Exactly five cards, in this order: Sprzedaż, Inspektor Ochrony Danych, Kariera,
  Wsparcie, Siedziba.
  - Four team cards each carry a Polish description plus a `mailto:` link
    (`sales@`, `dpo@`, `careers@`, `support@studiq.pl`) and a `tel:` link
    (spaces stripped: `tel:+48123567890` … `tel:+48123567893`).
  - Siedziba: „Dane rejestrowe firmy”, „StudiQ sp. z o.o.”,
    „ul. Przykładowa 1, 00-001 Warszawa”, „Warszawa, Polska”,
    „NIP: 000-000-00-00”, „KRS: 0000000000”. The NIP/KRS are zero placeholders,
    which still satisfies the case (it requires the fields, not their values).
- Public shell is present and in Polish: header Funkcje `/features`, Cennik
  `/pricing`, Logowanie `/login`, Rejestracja `/register`; footer columns
  Produkt / Firma / Prawne with Kontakt `/contact`, Polityka Prywatności
  `/privacy`, Regulamin `/terms`.
- No console errors, uncaught exceptions or HTTP responses ≥ 400; no raw
  translation keys, `undefined` or `NaN` in the rendered text.
- The case text matches the product; nothing contradicted it, so no defect was
  filed.
