# PUB-06 — Polityka prywatności i Regulamin

- id: PUB-06
- priority: P3 kosmetyczny
- module: PUB – Strony publiczne i nawigacja ogólna
- section: Funkcje, Cennik, Kontakt, strony prawne
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Otwórz /privacy, a następnie /terms.
2. Przełącz język na angielski (zob. NFR-02) i odśwież obie strony.

## Expected result

- Obie strony zawierają wszystkie sekcje (Administrator Danych … Kontakt; Postanowienia Ogólne … Kontakt).
- Treść jest czytelna; zanotuj błędy językowe (np. w Regulaminie wyraz w obcym alfabecie w sekcji „Płatności i Subskrypcje” – „сохраняется”).
- Po zmianie języka odpowiadająca wersja się ładuje (lub zanotuj brak tłumaczenia).

## Suite seed — tenant model (reconciled)

The case was generated against the legacy manual seed, but its prerequisite is
"no session": both pages are public. The suite version therefore needs no tenant
user, content id or organisation — only the shared app and a fresh browser context
(empty cookie jar).

- Case tenant (deterministic, bookkeeping only):
  `tenantKey('qa/cases/PUB-06.md', 'PUB-06', 'qa-shared')` → `PUB-06.md::PUB-06::qa-shared`
- Seed: `bun scripts/qa-tenant.ts PUB-06` (org + manager/teacher/student, password
  `Seed4Test!`) — the spec asserts none of those rows.
- Spec: `qa/tests/PUB/PUB-06.spec.ts`, project `qa/playwright.qa.config.ts`,
  baseURL `http://localhost:3010`.
- Isolation: the test starts with an empty cookie jar, so `NEXT_LOCALE` falls back
  to the `pl` default and it never reads or writes another tenant's data.

## Observed during the suite walk (2026-10-28)

- Both pages render all sections in Polish by default: 8 on `/privacy`
  (Administrator Danych … Kontakt) and 9 on `/terms` (Postanowienia Ogólne … Kontakt).
- The footer language toggle switches the page in place, `NEXT_LOCALE=en` survives
  a reload, and both pages then render the English copy.
- The Cyrillic word "сохраняется" reported for „Płatności i Subskrypcje" is **not**
  present: the section reads „…a dostęp jest zachowany do końca okresu
  rozliczeniowego." — the language defect is already fixed on this branch.
