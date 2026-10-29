# MGR-MEM-05 — Zarządzanie przynależnością do grup członka

- id: MGR-MEM-05
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Członkowie (/manage/members)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

M1, WSB Merito; grupy O1G1, O1G2.

## Steps

1. Kliknij „Zarządzaj grupami” przy S1.
2. Zaznacz O1G2, ustaw rolę w grupie (member/teacher), odznacz O1G1; zapisz.

## Expected result

- Okno „Zarządzaj grupami: S1” z checkboxami grup i wyborem roli.
- Toast „Przynależność do grup zaktualizowana”; kolumna Grupy w tabeli pokazuje nowy stan.
- S1 widzi teraz treści grupy O1G2, a nie O1G1.

## Prerequisite context (tenant model)

The automated case never uses the manual seed (`manager@dev.local`, `pass`). It owns a
seeded tenant instead:

- **Tenant key**: `tenantKey('qa/cases/MGR-MEM-05.md', 'MGR-MEM-05 group membership', 'qa-shared')`
  plus a per-run suffix (`QA_RUN_SUFFIX`, otherwise fresh). Every org/user/group/deck id
  is `tenantId(key, entity)`.
- **Organization**: one org with `plan = launch`, whose **manager** is its `admin` (the
  only account that uses the members page). A seeded **teacher** and **student** are
  plain members; the student is the case's „S1”.
- **Groups** (the case's `O1G1`, `O1G2`): the default `O1G1` holds the manager (teacher),
  the teacher and the student (members); `O1G2` starts with the manager as its teacher
  only. Both are created through `seedTenantGraph()`.
- **Content**: one group-visible deck per group (`O1G1 deck`, `O1G2 deck`) with a
  `deck_groups` link, so „S1 widzi treści grupy” is observable. Decks require a group
  teacher for the share, hence the manager's teacher membership in both groups.
- The spec seeds the graph at run time with the shared helpers
  (`__tests__/helpers/tenant-seed.ts`) because every independent run needs a clean
  organization, groups and deck links.

## Walk observations (qa-env-5, shared app 3010 / DB 54421, pl)

- `/manage/members` (sidebar „Członkowie”) lists the members with the columns
  **Członek / Rola / Grupy / Dołączył / Akcje**; the „Grupy” cell renders one outline
  badge per group, a member with no group shows „—”, and the own account row has no
  group button (it shows „(ty)”).
- „Zarządzaj grupami” is a ghost button on every other member's row. It opens the
  dialog **„Zarządzaj grupami: <imię>”** with one checkbox + group-name label per
  organization group; a checked group also renders its role select, whose value is
  „Członek” (`member`) by default and whose options are **„Nauczyciel”** (`teacher`) and
  **„Członek”** (`member`). Unchecking hides the select.
- „Zapisz” issues one `PUT /api/v1/organization/groups/<id>/members` per changed group,
  shows the toast **„Przynależność do grup zaktualizowana”**, closes the dialog and
  reloads the table: only the new group badge remains in the student's row and the other
  members' rows are untouched. Cancelling or saving without changes leaves everything as
  it was (no toast).
- The group counters on `GET /api/v1/organization/groups` follow the change (moving the
  student as `teacher` takes `O1G1` to 2 members / 1 teacher and `O1G2` to 2 members /
  2 teachers).
- The student's `/app/flashcards` list is driven by group membership: before the move it
  contains only the `O1G1 deck`; after the move and a reload it contains only the
  `O1G2 deck`. Card names render twice in the DOM (mobile row + desktop card), so the
  spec only counts visible headings.
- Same deep-link race as MGR-GRP-01: the first hard load of an org-scoped `/manage`
  page right after an API login without an active-organization cookie can answer `403`
  until the org context settles. The spec enters from `/manage` (dashboard) and clicks
  the sidebar entry, and pins `active_org_id` for its own org, so the walk is stable.
- No product defect found: the toast, the row state, the API state and the student's
  content visibility all match the case's expected result.
