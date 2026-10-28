# MGR-03 — Dane różnią się między organizacjami

- id: MGR-03
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Pulpit managera
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

M1 ma dwie organizacje.

## Prerequisite context (tenant model)

The verbatim prerequisite names the legacy manual seed („M1” with WSB Merito and
UE Wrocław, members S1/S2, groups O1G*/O2G*). The automated case owns a seeded
tenant with the same shape instead:

- **Tenant key**: `tenantKey('qa/cases/MGR-03.md', 'MGR-03#<run>', 'qa-shared')`
  plus a per-run suffix (`QA_RUN_SUFFIX`, otherwise fresh). Every org/user/group
  id is `tenantId(key, entity)`; the two organizations use the same key with an
  `:a` / `:b` suffix for their membership rows.
- **Organizations**: `qa-mgr03-<run>-a` (the „WSB Merito” substitute) and
  `qa-mgr03-<run>-b` (the „UE Wrocław” substitute). The seeded `manager` is
  `admin` in **both**.
- **Users** (password `Seed4Test!`): `manager` (manager, admin in both orgs),
  `teacher-a` (educator, org role `teacher` in A), `student-a` (student, org role
  `member` in A), `student-b` (student, org role `member` in B). Org A therefore
  has 3 members (1 teacher, 1 student), org B has 2 (0 teachers, 1 student).
- **Groups**: A → `O1G1` (default, manager + T1 + S1) and `O1G2` (empty);
  B → `O2G1` (default, manager + S2) — the document's `O1G*` / `O2G*`.
- **Invitations**: one pending `member` invitation per org, minted by the
  `manager` through `POST /api/v1/organization/invites` with an explicit
  `organizationId` (the same request MGR-INV-01 makes), so list scoping is real.
- The spec seeds the graph at run time with the shared helpers
  (`__tests__/helpers/tenant-seed.ts`) because the two-org shape is not in
  `qa/tests/profiles.json`; an out-of-band `qa/.tenants/MGR-03.json` would also
  not give each independent run a fresh tenant.

## Walk observations (shared app :3010, Polish UI)

- The org switcher sits in the sidebar header: trigger shows the active org name
  and role „Admin”; the menu lists both organizations (each with its role) and a
  check mark on the active one, plus „Dołącz do klasy”. Selecting the other org
  keeps/returns the manager to `/manage` and the header immediately shows the new
  org; no manual refresh is needed.
- Dashboard after the switch: A shows 3 total / 1 teacher / 1 student; B shows
  2 / 0 / 1. „Ostatni członkowie” follows the active org (A: QA S1, QA T1, QA M1;
  B: QA S2, QA M1).
- `/manage/members`: A lists QA M1, QA T1, QA S1 (3 łącznie) with group `O1G1`;
  B lists QA M1, QA S2 (2 łącznie) with group `O2G1`. The other org's rows never
  appear.
- `/manage/groups`: A shows `O1G1` (3 members, 1 teacher — the manager counts as
  the group teacher) and empty `O1G2`; B shows only `O2G1` (2 members,
  1 teacher). Switching back restores A's groups.
- `/manage/invites`: A lists only `qa-mgr03-a-<run>@test.local` and B only
  `qa-mgr03-b-<run>@test.local`, both status „Oczekujące”. The „Wysłane
  zaproszenia” table is the only list (no other org's invitation leaks in).
- Switching from a sub-page (e.g. `/manage/invites`) also lands on `/manage`.
- A hard reload keeps the active organization in both directions (no fallback to
  the first membership); `GET /api/v1/me/orgs` reports `isActive: true` for it.
- No deviation from the expected result was observed.

## Steps

1. Przełącz aktywną organizację z WSB Merito na UE Wrocław (przełącznik u góry paska).
2. Porównaj członków, grupy, zaproszenia.

## Expected result

- Po przełączeniu następuje powrót na /manage; dane (członkowie: S1 vs S2, grupy O1G* vs O2G*) odpowiadają aktywnej organizacji.
- Brak mieszania danych między organizacjami.
