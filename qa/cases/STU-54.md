# STU-54 — Student bez analiz (plan launch/base)

- id: STU-54
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Statystyki studenta – część diagnostyczna
- prereqs: none (self-contained tenant — see Seed)
- source: phase 5d entitlement gate (`stats.insights`, ADR-0015 §7)

## Prerequisite (verbatim)

Student na darmowym planie (organizacja `launch`, plan osobisty `base`) — bez entitlementu
`stats.insights`.

## Seed (QA-suite)

- Tenant: the case's own `content` tenant on the free `launch` plan
  (`__tests__/qa/profiles/STU-54.json` declares `"content"`; `launch` is the DB default — no
  `--plan` override), seeded with
  `bun scripts/qa-tenant.ts STU-54 --fresh` — one fresh run suffix per independent run. All
  ids come from `tenantKey('qa/cases/STU-54.md', 'STU-54#<run>', 'qa-shared')` +
  `tenantId(key, entity)`; the spec reads them through `loadTenant('STU-54')`.
- Account: the tenant's `users.student` (org role `member`, personal plan `base`), logged in
  with the tenant org as the active org (`loginAs(page, tenant, 'student', { locale: 'pl' })`).
  Neither `launch` nor `base` carries `stats.insights`, so `GET /api/v1/features/me` does not
  list it.
- Organization: `qa-stu-54-<suffix>` with a manager, a teacher and a student, plus the default
  group `G1`. Nothing shared is read or written: no admin setting, feature flag, plan,
  platform stat or singleton row, and no other tenant.

## Steps

1. Otwórz /app/stats/activity jako student na planie base.
2. Wywołaj `GET /api/v1/stats/weak-points` i `GET /api/v1/stats/student/insights?days=30`
   przez API.
3. Otwórz /app/stats/content oraz /app/stats/results.

## Expected result

- /app/stats/activity pokazuje karty opisowe (Powtórki w tym tygodniu, Poprawne, Do powtórki
  dziś, wykres „Aktywność dzienna”, „Podział stanów”), a sekcje „Najsłabsze talie” /
  „Najsłabsze tematy” oraz „Czas nauki” pokazują kartę planu („Analizy i słabe punkty” +
  „Zobacz plany”).
- `GET /api/v1/stats/weak-points` → 403 `FORBIDDEN`; `GET /api/v1/stats/student/insights` →
  403 `FORBIDDEN` (bramka entitlementu).
- /app/stats/content i /app/stats/results pokazują karty planu zamiast „Krzywej
  zapamiętywania” i „Opanowania tematów”; opisywana część (reszta stron statystyk) zostaje.
