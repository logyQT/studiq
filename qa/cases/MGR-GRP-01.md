# MGR-GRP-01 — Lista, tworzenie, edycja i usuwanie grup

- id: MGR-GRP-01
- priority: P1 krytyczny
- module: MGR – Panel managera organizacji (/manage)
- section: Grupy (/manage/groups)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

M1, WSB Merito (2 grupy).

## Steps

1. Otwórz /manage/groups.
2. Utwórz grupę „Grupa C” z opisem.
3. Edytuj nazwę, a następnie usuń.

## Expected result

- Tabela: Nazwa, Członkowie, Nauczyciele, Akcje.
- Toasty „Grupa utworzona”, „Grupa zaktualizowana”, „Grupa usunięta”; okno usunięcia zawiera ostrzeżenie o usunięciu członków z grupy.

## Prerequisite context (tenant model)

The automated case never uses the manual seed (`manager@dev.local`, `pass`). It owns a
seeded tenant instead:

- **Tenant key**: `tenantKey('qa/cases/MGR-GRP-01.md', 'MGR-GRP-01 groups CRUD', 'qa-shared')`
  plus a per-run suffix (`QA_RUN_SUFFIX`, otherwise fresh). Every org/user/group id is
  `tenantId(key, entity)`.
- **Organization**: one org with `plan = launch` (the seeder default), whose **manager**
  is its `admin` — the only role the case uses. The org role carries `group.manage`, which
  both the page (`useFeature()`) and `POST/PUT/DELETE /api/v1/organization/groups`
  (`requireFeature`) enforce, so the write controls are only there for this tenant.
- **Groups** (the case's „2 grupy”): the default `G1`, where the manager is the `teacher`
  and a seeded teacher + student are members (renders 3 / 1), plus an empty `G2`
  (0 / 0). Both are created through `seedTenantGraph()`.
- **Profile**: no content (no decks/banks/quizzes); the case only touches the groups
  surface.
- The spec seeds the graph at run time with the shared helpers
  (`__tests__/helpers/tenant-seed.ts`) because every independent run needs a clean
  organization and its own copy of „Grupa C”.

## Walk observations (qa-env-5, shared app 3010 / DB 54421, pl)

- `/manage/groups` (sidebar „Grupy”) shows the heading and card title „Grupy”, the
  „Nowa grupa” button, and the table with the columns **Nazwa / Członkowie /
  Nauczyciele / Akcje**. The member count is a secondary badge, the teacher count is
  plain text; both come from `group_members` (G1 with the manager as teacher and two
  members renders 3 / 1, an empty group renders 0 / 0 while still being listed).
- Row actions are ghost icon buttons whose accessible name is the sr-only label:
  „Zarządzaj członkami”, „Edytuj grupę <nazwa>”, „Usuń grupę <nazwa>”.
- „Nowa grupa” opens the Radix dialog „Utwórz grupę” with two unlabelled textboxes
  („Nazwa”, „Opis” — the labels are not associated with the inputs) and the buttons
  „Anuluj” / „Utwórz”. Submitting shows the toast „Grupa utworzona”, closes the dialog and
  the row appears immediately with the description under the name and 0 / 0 counts; the
  description is stored by the API (`GET /api/v1/organization/groups`).
- „Edytuj grupę <nazwa>” opens „Edytuj grupę” with the name and description pre-filled;
  „Zapisz” shows „Grupa zaktualizowana” and renames the row in place, keeping the
  description and the group id.
- „Usuń grupę <nazwa>” opens the dialog „Usunąć grupę?” with the warning „Spowoduje to
  usunięcie wszystkich członków z tej grupy. Tej operacji nie można cofnąć.” and the
  buttons „Anuluj” / „Usuń”. „Anuluj” closes it and leaves the group untouched; „Usuń”
  shows „Grupa usunięta”, removes the row and the row is gone from the API, while the two
  seeded groups (and their counts) stay.
- Same deep-link race as MGR-INV-03: the **first** hard load of `/manage/groups` right
  after an API login that has no active-organization cookie yet can answer `403` and
  render the error/empty state until it is reloaded. The spec therefore enters the page the
  way a user does (login → `/manage` dashboard → „Grupy” in the sidebar), which settles the
  active org first.
