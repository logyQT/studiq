# EDU-GRP-03 — Edycja i usuwanie grupy

- id: EDU-GRP-03
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Grupy nauczyciela (/edu/groups)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Grupa utworzona przez T1.

## Steps

1. Edytuj nazwę i opis, usuń grupę.
2. Spróbuj edytować grupę utworzoną przez innego użytkownika (np. O1G2).

## Expected result

- Okno usunięcia: „Usunąć grupę?” – „Spowoduje to usunięcie wszystkich członków z tej grupy…”.
- Cudza grupa: komunikat „Grupa utworzona przez kogoś innego — nie możesz jej edytować” / akcje wyłączone.

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`teacher1@dev.local`, `teacher2@dev.local`,
groups `O1G1`/`O1G2`, password `pass`). The suite version uses the case's own tenant and never
the legacy accounts.

```bash
bun scripts/qa-tenant.ts EDU-GRP-03 --fresh   # profile from __tests__/qa/profiles/EDU-GRP-03.json
```

- Profile: `org-limit` (`__tests__/qa/profiles/EDU-GRP-03.json`). It is the seeded shape that gives
  the organization **two teachers with the real org `teacher` role** — the entitlement that
  carries `group.manage` and therefore the „Nowa grupa”/„Edytuj”/„Usuń” actions on `/edu/groups`.
  The `content` profile seeds its single teacher as an org `member`, so it cannot manage groups.
- Tenant key: `tenantKey('qa/cases/EDU-GRP-03.md', 'EDU-GRP-03#<run>', 'qa-shared')`, every
  org/user/group id from `tenantId(key, entity)`; organization `qa-edu-grp-03-<run>`, default
  group `G1`. `--fresh` gives each independent run its own organization, so ids stay
  deterministic inside a run and no run reuses another's data.
- Users: `users.teacher` is **T1** (the teacher under test), `users.teacher2` is **T2** (the
  colleague in step 2), `users.manager` is the org admin who created the seeded `G1`, and
  `users.student` is S1.
- Prerequisites: the spec creates „Grupa T1 <run>” through `POST /api/v1/organization/groups`
  **as T1** (so `created_by` is T1, exactly the case's „Grupa utworzona przez T1”) and
  „Grupa T2 <run>” **as T2** in a second API context (the „grupa utworzona przez innego
  użytkownika” of step 2). Leftovers from an interrupted earlier run are deleted by exact name
  before seeding: the org is on Launch (3 groups) and already holds `G1`, so a retry against the
  same tenant must not hit the group limit. The run ends with T1's group deleted.
- Walk notes (shared app, `NEXT_LOCALE=pl`): `/edu/groups` lists every org group with columns
  Nazwa / Członkowie / Nauczyciele / Akcje; T1's own row offers „Zarządzaj członkami”,
  „Edytuj grupę <nazwa>” and „Usuń grupę <nazwa>”. A group created by someone else renders
  without those three actions: only a lock icon whose `title` is exactly „Grupa utworzona przez
  kogoś innego — nie możesz jej edytować” (plus „Zgłoś nieprawidłowość”).
- Edit: the „Edytuj grupę” dialog opens pre-filled with name and description, „Zapisz” shows
  „Grupa zaktualizowana” and renames the row in place with the new description.
- Delete: „Usuń grupę <nazwa>” opens „Usunąć grupę?” with the description
  „Spowoduje to usunięcie wszystkich członków z tej grupy. Tej operacji nie można cofnąć.”;
  „Anuluj” keeps the group, „Usuń” shows „Grupa usunięta” and removes the row and the API row.
- Isolation: T1's `PUT`/`DELETE` on T2's group answer `403 FORBIDDEN` and leave it unchanged —
  the disabled UI is backed by the server, not just hidden buttons.
- Nothing global is read or written: no admin setting, feature flag, plan, platform stat or
  singleton row; only this tenant's org, users and groups.
- Spec: `__tests__/qa/EDU/EDU-GRP-03.spec.ts`; run with
  `bunx playwright test -c qa/playwright.qa.config.ts __tests__/qa/EDU/EDU-GRP-03.spec.ts --workers=1`.
