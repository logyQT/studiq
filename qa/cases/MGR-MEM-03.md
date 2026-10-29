# MGR-MEM-03 — Zmiana własnej roli / ostatni admin

- id: MGR-MEM-03
- priority: P1 krytyczny
- module: MGR – Panel managera organizacji (/manage)
- section: Członkowie (/manage/members)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

M1 jest jedynym adminem WSB Merito.

## Steps

1. Spróbuj zmienić własną rolę admina na Member.
2. Spróbuj usunąć siebie z organizacji.

## Expected result

- Aplikacja nie powinna pozwolić na pozostawienie organizacji bez administratora; oczekiwany jest błąd lub zablokowana akcja. Zanotuj faktyczne zachowanie (potencjalnie krytyczne).

## Prerequisite context (tenant model)

The automated case never uses the manual seed (`manager@dev.local`, `pass`). It owns a
seeded tenant instead:

- **Tenant key**: `tenantKey('qa/cases/MGR-MEM-03.md', 'MGR-MEM-03 self role change and self removal are blocked', 'qa-shared')`
  plus a per-run suffix (`QA_RUN_SUFFIX`, otherwise fresh). Every org/user/role id is
  `tenantId(key, entity)`.
- **Organization**: one org (`qa-mgr-mem03-<run>`) whose only `admin` is the seeded
  `manager` — the „M1 jest jedynym adminem” prerequisite. The system roles
  `admin` / `teacher` / `member` come from the organization trigger.
- **Other members**: one `teacher` and one `member`, so the members table has rows that
  still expose the role select and the remove control; the case contrasts the admin's own
  row against them.
- **Profile**: no content (`content` graph minus decks/banks/quizzes); the case only
  touches the membership surface.
- The spec seeds the graph at run time with the shared helpers
  (`__tests__/helpers/tenant-seed.ts`) because every independent run needs its own
  organization whose admin has never changed role.

## Walk observations (qa-env-2, shared app 3010 / DB 54421, pl)

- `/manage/members` („Członkowie”) lists the admin's own row with the role „Admin” and the
  actions cell showing only „(ty)” — no role combobox, no „Zarządzaj grupami”, no
  „Usuń członka”. Other rows expose all three controls, so the omission is specific to the
  caller's own row. The UI therefore blocks step 1 and step 2 before any request.
- The requests the page would send are rejected by the server as well:
  - `PUT /api/v1/organization/members` with `{ targetUserId: <self>, newOrgRoleId: <member> }`
    → **403** `{"success":false,"error":"FORBIDDEN"}`;
  - `DELETE /api/v1/organization/members?userId=<self>` → **403**
    `{"success":false,"error":"FORBIDDEN"}`.
- After both attempts `GET /api/v1/organization/members` still returns the caller with role
  `admin` and the organization still has exactly one `admin`; the reloaded page shows the
  same „Admin” + „(ty)” row, so nothing was applied optimistically.
- The guard is self-scoped: the same session can still change another member's role and
  remove another member (`200 { success: true }` for both), so the organization keeps an
  administrator without the manager losing the ability to manage others.
- Not asserted (out of scope): with a **second** admin present the server still rejects a
  self-demotion (the check is `targetUserId === ctx.userId`, not an admin-count check). The
  case only requires that the organization is never left without an administrator, which
  this stricter behaviour satisfies.
