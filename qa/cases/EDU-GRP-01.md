# EDU-GRP-01 — Lista i tworzenie grup

- id: EDU-GRP-01
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Grupy nauczyciela (/edu/groups)
- prereqs: tenant `org-limit` (educator with the org `teacher` role → `group.manage`)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

T1 (plan Lite – group.manage).

## Steps

1. Otwórz /edu/groups.
2. Kliknij „Nowa grupa”, nazwa „Grupa testowa”, opis; zapisz.

## Expected result

- Lista grup z kolumnami Nazwa / Członkowie / Nauczyciele / Akcje.
- Toast „Grupa utworzona”.

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`teacher1@dev.local`, password `pass`,
organization WSB Merito, group `O1G1`). The suite version uses the case's own tenant and never
the legacy accounts.

- Profile: `org-limit` (`qa/tests/profiles/EDU-GRP-01.json`) — one organization with an
  `admin` manager, two org-`teacher` educators and one org-`member` student, plus the default
  group `G1` (every member enrolled, the manager as its group `teacher`). The case only uses
  the first educator (`teacher`) and `G1`; the extra accounts keep the profile shared with the
  member-limit case.
- Why that profile: the prerequisite „group.manage” is an org-role entitlement, not a personal
  plan. The org trigger seeds `org_role_features` per role, so an org-`member` educator (the
  `content` profile's teacher) resolves no `group.manage` and sees a read-only list without
  „Nowa grupa”. `org-limit` is the seeder's only shape whose educator holds the org `teacher`
  role, which carries `group.manage` on the default `launch` org plan.
- Seed: `bun scripts/qa-tenant.ts EDU-GRP-01 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/group/users from
  `tenantKey('qa/cases/EDU-GRP-01.md', 'EDU-GRP-01#<suffix>', 'qa-shared')` +
  `tenantId(key, entity)`. The spec reads the ids through `loadTenant('EDU-GRP-01')`.
- The spec creates „Grupa testowa” through the UI and then deletes it (and any same-named
  leftover of a retried run) through `DELETE /api/v1/organization/groups/:id`, so re-runs on
  one seeded tenant stay under the org plan's three-group limit. Nothing global is written: no
  admin setting, feature flag, plan row or singleton.
- Not asserted: the second educator/member/invitee accounts of the profile — they are only
  there because the profile is shared; the case is about the educator's own list and the
  creation flow.
