# STU-45 — Dostęp do AI zależny od planu

- id: STU-45
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Asystent AI (/app/ai)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Konto S1 (plan Free – bez ai.chat).

## Seed (QA-suite)

- Tenant: the case's own `content` tenant on the default free plans — the organization on
  `launch` and the accounts' personal plan `free` (both DB defaults; no `--plan` or
  `--personal-plan` override, and no profile file beyond the default `content` shape), seeded with
  `bun scripts/qa-tenant.ts STU-45 --fresh` — one fresh run suffix per independent run. All ids
  come from the seeder key (`tenantKey('qa/cases/STU-45.md', 'STU-45#<run>', 'qa-shared')`) plus
  `tenantId(key, entity)`; the spec reads them through `loadTenant('STU-45')`.
- Account: the tenant's `users.student` (org role `member`, personal plan `free`), logged in with
  the tenant org as the active org (`loginAs(page, tenant, 'student', { locale: 'pl' })`). Neither
  `launch` nor `free` carries `ai.chat`, so `GET /api/v1/me/entitlements` does not list it and
  `max_ai_tokens_per_day` is `0`.
- Organization: `qa-stu-45-<suffix>` with a manager, a teacher and a student, plus the default
  group `G1`. Nothing shared is read or written: no admin setting, feature flag, plan, platform
  stat or singleton row, and no other tenant.

## Steps

1. Sprawdź menu boczne.
2. Wejdź ręcznie na /app/ai.

## Expected result

- Pozycja „Asystent Q” niewidoczna w menu dla planu Free.
- Bezpośrednie wejście na /app/ai: zanotuj zachowanie (strona może się wyświetlić; wywołania API powinny być ograniczone planem/limitem tokenów = 0).
