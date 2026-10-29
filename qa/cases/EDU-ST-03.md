# EDU-ST-03 — Statystyki – „Aktywność” (/edu/stats/activity)

- id: EDU-ST-03
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Statystyki nauczyciela
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Aktywność studentów w ostatnich dniach.

## Seed (tenant model)

Legacy accounts (`teacher1@dev.local`, `student1@dev.local`, password `pass`) are
never used. The case runs in its own deterministic tenant, declared in
`qa/tests/profiles/EDU-ST-03.json` (`{ "profile": "content" }`):

```bash
bun scripts/qa-tenant.ts EDU-ST-03 --fresh
```

- tenant key: `tenantKey('qa/cases/EDU-ST-03.md', 'EDU-ST-03#<suffix>', 'qa-shared')`
- org `qa-edu-st-03-<suffix>` with a manager, an educator and a student, plus the
  default group `G1`
- the educator logs in through the real `/api/v1/auth/login` (fixture password
  `Seed4Test!`) with `active_org_id` set to the tenant org; the student builds the
  activity in a second browser context
- the activity the page reports is created inside the tenant through the product
  API: the student practices three cards (two correct, one wrong → 3 powtórki,
  67% poprawności) and completes one practice quiz. A retried run (CI seeds once
  and retries) first clears this tenant student's own practice rows, daily
  counters, attempts, decks and banks, so it starts from the empty period again.

## Steps

1. Otwórz /edu/stats/activity.
2. Przełączaj zakres 7 / 30 / 90 dni.

## Expected result

- Karty: Aktywni studenci, Łącznie powtórki, Śr. poprawność, Wykonane testy z porównaniem do poprzedniego okresu.
- Wykres aktywności dziennej, tabela „Zaangażowanie studentów” ze statusem (Aktywny / Ostatnio / Może potrzebować wsparcia), „Aktywność testowa”.
- Brak danych: „Brak danych o aktywności w tym okresie”.

## Walk observations (shared app :3010, worker qa-env-2, 2026-10-29)

- Heading „Aktywność studentów”, description „Monitoruj zaangażowanie swoich
  studentów”; range buttons „7 dni” / „30 dni” / „90 dni”, the selected one is the
  primary button, and each click calls
  `/api/v1/stats/teacher/activity?range=7d|30d|90d`.
- Empty period (fresh tenant): only „Brak danych o aktywności w tym okresie” —
  no summary cards, no chart and no table, for all three ranges (the #209 fix).
- With activity: cards „Aktywni studenci” = 1, „Łącznie powtórki” = 3,
  „Śr. poprawność” = 67%, „Wykonane testy” = 1. Because the previous period is
  empty, every card shows „brak danych w poprzednim okresie” (#211) instead of a
  percentage and the „w porównaniu do poprzedniego okresu” caption.
- Chart card „Aktywność dzienna” with the active range as its description and the
  legend „Powtórki” (bars) / „Aktywni studenci” (line); the x-axis days follow
  the range (7 / 30 / 90 points).
- Table card „Zaangażowanie studentów” with the active range as its description
  and the columns Student / Ostatnia aktywność / Powtórki / Poprawność / Testy /
  Status. The tenant student reads „Dzisiaj”, 3, 67%, 1 and the badge
  „🟢 Aktywny”; only that row is active.
- Switching 30 / 90 days keeps today's totals and updates both card
  descriptions to „30 dni” / „90 dni”.
- **Product deviation #208:** the case's „Aktywność testowa” card was removed —
  it grouped practice attempts by `quiz_attempts.config.difficulty`, a value
  nothing writes, so every attempt fell into the „mixed” catch-all. Attempt
  counts remain in „Wykonane testy” and the per-student „Testy” column; the page
  has no „Aktywność testowa” section and the spec does not expect one.
- No browser console errors or failed activity requests during the walk.
