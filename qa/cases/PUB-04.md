# PUB-04 — Podstrona planów (/pricing/student) – karty planów

- id: PUB-04
- priority: P2 ważny
- module: PUB – Strony publiczne i nawigacja ogólna
- section: Funkcje, Cennik, Kontakt, strony prawne
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Suite fixture (tenant model)

The public walk needs no session; the QA-suite spec still seeds this case's isolated
tenant so the signed-in variant of the same page (current-plan badge, checkout CTA)
is covered without touching another worker's data.

- Tenant: `tenantKey("qa/cases/PUB-04.md", "PUB-04", "qa-shared")`
  → `qa/.tenants/PUB-04.json`
- Seed: `bun scripts/qa-tenant.ts PUB-04` (org `qa-pub-04-<hash>`, users `Seed4Test!`,
  group `G1`). Re-run with `--reset` before a fresh run.
- Page locale: `NEXT_LOCALE=pl` (the copy in the expected result is Polish).
- Plan catalog: global and **read-only** for this case. The spec derives the expected
  prices/features/limits from `GET /api/v1/subscription-plans?for=student` and never
  edits plans, flags or settings.
- Spec: `qa/tests/PUB/PUB-04.spec.ts` (run with `qa/playwright.qa.config.ts`).

## Steps

1. Otwórz /pricing/student.
2. Dla każdej karty sprawdź: nazwę, cenę, listę funkcji i limitów, przycisk CTA.

## Expected result

- Ceny zgodne z konfiguracją: Base 0 zł; Spark 9,99 zł; Ace 19,99 zł; Pro 49,99 zł /miesiąc (wartości wyświetlane z groszy: 999 → 9,99).
- Funkcje: Base – Fiszki, Testy; Ace/Pro – dodatkowo Asystent AI i Zaawansowane Statystyki.
- Limity wyświetlane czytelnie, „Bez ograniczeń” dla wartości -1.
- CTA różni się per plan (np. „Zacznij za Darmo”, „Przejdź na Spark”, „Wybierz Ace”, „Wybierz Pro”).
- Plan „Ace”/„Pro” ma wyróżnienie „Najpopularniejszy” (jeśli skonfigurowane).
