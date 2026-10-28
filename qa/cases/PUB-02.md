# PUB-02 — Strona „Funkcje” (/features)

- id: PUB-02
- priority: P2 ważny
- module: PUB – Strony publiczne i nawigacja ogólna
- section: Funkcje, Cennik, Kontakt, strony prawne
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Otwórz /features.
2. Przejrzyj listę funkcji i tabelę „Porównanie Planów”.

## Expected result

- Tytuł „Wszystko Czego Potrzebujesz, Aby Odnieść Sukces”.
- Karty funkcji z oznaczeniem planu (Darmowy / Premium / Uniwersytecki), np. „Ręczne Tworzenie Pytań – Darmowy”, „Generowanie Pytań przez AI – Premium”.
- Tabela porównania: kolumny Darmowy / Premium / Uniwersytecki, wartości Tak / Nie / Indywidualny.
- Przycisk „Zacznij Za Darmo” prowadzi do rejestracji.

## Seed (qa-suite)

- Tenant: `tenantKey('qa/cases/PUB-02.md', 'PUB-02', 'qa-shared')` →
  org `8b6f5829-4345-50e7-bc40-bb4244357866` (`qa-pub-02-shared`), seeded with
  `bun scripts/qa-tenant.ts PUB-02`.
- The case needs **no session and no tenant data**: `/features` is public. The spec
  runs anonymously; the deterministic tenant exists for suite bookkeeping only.
- Spec: `qa/tests/PUB/PUB-02.spec.ts`, run with
  `bunx playwright test qa/tests/PUB/PUB-02.spec.ts --config qa/playwright.qa.config.ts --workers=1 --repeat-each=1`.

## Observed vs document (2026-10-28)

The comparison table renders **Tak / Nie**, not „Indywidualny”: an included feature
is a check icon plus the text „Tak”, a missing one is „— Nie” (#291/#639). The only
„Indywidualny” in the plan catalogue is the Uniwersytecki **price**
(`PricingPage.university_price`), not a comparison-table value; the
`FeaturesPage.comparison_custom` message is unused. The spec asserts the rendered
Tak/Nie contract (which also guards the screen-reader regression from #291) and the
three plan columns; it does not require „Indywidualny” in the table.
