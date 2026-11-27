# EDU-QZ-03 — Zmiana kolejności i punktów pytań

- id: EDU-QZ-03
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Quizy – kreator (/edu/quizzes)
- prereqs: none (self-contained tenant — see Seed)
- source: StudiQ Dokument Testera v1.3

## Amendment (2026-11-26, B2 #1493)

Hub carries `quiz.templates` cumulatively since #1493, and the `teacher` org role resolves the whole ceiling (`entitlement_profile: 'all'`), so the `quiz.templates` gate passes through the org plan. The educator's personal Plus plan (`personalPlan: "plus", personalRole: "teacher"`) adds the portable `ai.chat`.

## Prerequisite (verbatim)

Quiz z ≥ 3 pytaniami.

## Seed (QA-suite)

- Tenant: the case's own `content` tenant (`__tests__/qa/profiles/EDU-QZ-03.json`),
  seeded with `bun scripts/qa-tenant.ts EDU-QZ-03 --fresh` — one fresh run suffix
  per independent run. All ids come from
  `tenantKey('qa/cases/EDU-QZ-03.md', 'EDU-QZ-03#<run>', 'qa-shared')` +
  `tenantId(key, entity)`.
- Accounts: the tenant's `users.teacher` is the educator editing the quiz — the
  legacy seed's `teacher1@dev.local` / `T1`, which the case implicitly assumes;
  that account is on the free `free` personal plan today.
  No legacy/manual account or `pass` is used.
- Organization: `qa-edu-qz-03-<suffix>` with a manager (admin), the teacher and the
  student, plus the default group `G1`. The tenant's active org is the tenant org, put on the
  **hub** plan by the profile
  (`{ "profile": "content", "plan": "hub", "personalPlan": "plus", "personalRole": "teacher" }`
  in `__tests__/qa/profiles/EDU-QZ-03.json`, applied through the seeder's `--plan`). Hub carries
  `quiz.templates` cumulatively since #1493 and the `teacher` role resolves the whole ceiling, so
  the saved-quiz library's `quiz.templates` entitlement (phase 5d) comes from the org plan; the
  personal Plus plan adds the portable `ai.chat`. The educator passes the write gates on
  `POST /api/v1/teacher/quizzes` and `POST /api/v1/teacher/quizzes/:id/questions`.
- Content: the spec creates the case's „quiz z ≥ 3 pytaniami” itself — one question
  bank and three questions through `POST /api/v1/questions/banks` +
  `POST /api/v1/questions`, then a quiz through `POST /api/v1/teacher/quizzes` and
  `POST /api/v1/teacher/quizzes/:id/questions`. Each execution uses its own tag, so
  re-running against the same tenant stays isolated. Nothing shared is read or
  written: no global admin setting, feature flag, plan, platform stat or singleton
  row, and no other tenant.
- UI note (walk on the shared app, Polish UI): the editor is
  `/edu/quizzes/<id>/edit` — heading „Edytuj quiz”, one row per question with a
  grip handle (drag), the points input „Punkty za pytanie N” and a trash button;
  the sticky bar reads „<n> pytania · Suma punktów: <sum>”, the amber indicator
  „Niezapisane zmiany” appears on the first edit, the button „Zapisz” saves
  immediately, and the 5-second autosave ends with the toast „Zapisano”.

## Steps

1. Przeciągnij pytanie na inną pozycję.
2. Zmień punkty jednego z pytań na 5.
3. Usuń jedno pytanie.

## Expected result

- Kolejność zmienia się natychmiast; „Suma punktów” jest zgodna ze zmianami.
- Zmiany oznaczone „Niezapisane zmiany”, potem „Zapisano” po autozapisie/przycisku „Zapisz”.
