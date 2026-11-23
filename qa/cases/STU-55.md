# STU-55 — Student z planem osobistym ace widzi analizy

- id: STU-55
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Statystyki studenta – część diagnostyczna (plan płatny)
- prereqs: none (self-contained tenant — see Seed)
- source: phase 5d entitlement gate (`stats.insights`, ADR-0015 §7) + positive control (R39)

## Prerequisite (verbatim)

Student z planem osobistym `ace` (entitlement `stats.insights` przenośny do organizacji launch —
D3) wewnątrz darmowej organizacji.

## Seed (QA-suite)

- Tenant: the case's own `content` tenant on the free `launch` plan
  (`__tests__/qa/profiles/STU-55.json` declares `"content"`; `launch` is the DB default — no
  `--plan` override), seeded with
  `bun scripts/qa-tenant.ts STU-55 --fresh` — one fresh run suffix per independent run. All
  ids come from `tenantKey('qa/cases/STU-55.md', 'STU-55#<run>', 'qa-shared')` +
  `tenantId(key, entity)`; the spec reads them through `loadTenant('STU-55')`.
- Account: the tenant's `users.student`. The spec moves the student's
  `profiles.personal_plan_key` to the paid `ace` plan through the service-role client (the same
  `finally`-restore pattern as SEC-07) before logging in, and restores the seeded plan in a
  `finally` block, so a CI retry on the same tenant starts clean. `ace` carries
  `stats.insights` and it is `personalPortable`, so the key resolves inside the `launch` org.
- Organization: `qa-stu-55-<suffix>` with a manager, a teacher and a student, plus the default
  group `G1`. Nothing shared is read or written: no admin setting, feature flag, plan change
  beyond this tenant's own student row, platform stat or singleton row, and no other tenant.

## Steps

1. Zaloguj się jako student z planem osobistym `ace` i otwórz /app/stats/activity.
2. Wywołaj `GET /api/v1/stats/weak-points` i `GET /api/v1/stats/student/insights?days=30`
   przez API.
3. Otwórz /app/stats/content oraz /app/stats/results.

## Expected result

- `GET /api/v1/me/entitlements` zawiera `stats.insights`.
- /app/stats/activity pokazuje sekcje „Najsłabsze talie” / „Najsłabsze tematy” bez karty
  planu (puste listy są w porządku — ważne, że nie ma blokady).
- `GET /api/v1/stats/weak-points` → 200; `GET /api/v1/stats/student/insights?days=30` → 200.
- /app/stats/content pokazuje „Krzywą zapamiętywania”, /app/stats/results pokazuje
  „Opanowanie tematów” — żadna z kart nie jest kartą planu.
