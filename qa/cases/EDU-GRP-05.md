# EDU-GRP-05 — Brak funkcji group.manage

- id: EDU-GRP-05
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Grupy nauczyciela (/edu/groups)
- prereqs: tenant `content` (educator whose org role carries no `group.manage`)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Użyj konta bez funkcji group.manage (konto bez tej funkcji).

## Steps

1. Odśwież panel nauczyciela.
2. Wejdź ręcznie na /edu/groups.

## Expected result

- Operacje zapisu na grupach są odrzucane (403 FORBIDDEN) – brak niezabezpieczonych akcji.

Case text settled on the model's guarantee (ADR-0015 §4.3, §7.1):

- Pozycja „Grupy” jest widoczna w menu dla każdego, czyja rola niesie `group.read`
  (także na zasięgu `group`, czyli Nauczyciel prowadzący klasę). Konto **bez**
  `group.read` nie widzi pozycji ani nie otwiera listy.
- Lista grup się renderuje: nagłówek „Grupy”, kolumny Nazwa / Członkowie / Nauczyciele /
  Akcje i zasiana grupa z jej liczbami.
- Brakuje **każdej** kontrolki zarządzania: „Nowa grupa”, „Edytuj grupę”, „Usuń grupę”
  i „Zarządzaj członkami” (wiersz pokazuje zamek „Grupa utworzona przez kogoś innego —
  nie możesz jej edytować”).
- Każdy zapis na grupach odpowiada `403 FORBIDDEN` — brak niezabezpieczonych akcji.

The earlier text — „Pozycja «Grupy» znika z menu” — described the 2.1 entitlement gate,
where `group.manage` hid the entry and the page stayed reachable by hand. Under the
permission model the list is the `group.read` surface and the writes are the
`group.manage`/`group.member.manage` surface, so the case asserts both halves instead of
the disappearing link.

## Observed on the shared app (walk, qa-env-1)

- The educator's sidebar had no „Grupy” entry (and no `a[href="/edu/groups"]` at all). The
  cause was the nav gate, not the role: the 2b-2 sidebar asked `usePermission('group.read')`
  without a resource, and `evaluateScope` only says yes to a `group`-scope row through a
  row (`ctx.groupRoles`), so a Teacher — the role the `group.read`/`group.manage` split was
  built for — never saw the link. Fixed in 2b-2: the nav asks `/permissions/me` whether the
  key is present (`apps/web/src/lib/sidebar-nav.ts`), the same key the API enforces.
- `/edu/groups` renders the **read-only** list: heading „Grupy”, the seeded group with its
  real counts, the lock badge and the report button. There is no „Nowa grupa”, no
  „Edytuj grupę”, no „Usuń grupę” and no member-management control.
- `POST /api/v1/organization/groups`, `PUT`/`DELETE /api/v1/organization/groups/:id` and
  `PUT /api/v1/organization/groups/:id/members` all answer `403` with
  `x-error-code: FORBIDDEN` and `{ "success": false, "error": "FORBIDDEN" }`; the group and
  its membership are unchanged afterwards.
- Since 2b-2 the list route answers `group.read` and every write resolves the `group.*`
  permission for that class (ADR-0015 §4.3), so a caller without `group.manage` is refused
  by the permission rather than by a persona gate — the four 403s are unchanged.

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`teacher1@dev.local`, password `pass`,
organization WSB Merito, group `O1G1`). The suite version uses the case's own tenant, never
the legacy accounts, and takes the prerequisite's second option — _„użyj konta bez tej
funkcji”_ — instead of mutating a global admin setting.

- Profile: `content` (`__tests__/qa/profiles/EDU-GRP-05.json`) — one organization with an
  `admin` manager, an org-`member` educator and an org-`member` student, plus the default
  group `G1` (all three enrolled, the manager as its group `teacher`).
- Why that profile: the group keys are permissions (ADR-0015 §4.1). The org `member` role
  holds `group.read` at `group` scope and no `group.manage`, `group.member.manage` or
  `group.invite`, so the educator is exactly „konto bez tej funkcji” — no admin-panel
  override and no write to `org_role_permissions`, `entitlement_flags` or any other global
  row. `G1`'s `manageVia` is `null`, which is what the page renders as the lock and what
  the spec asserts. The manager of the same tenant holds the Admin system role, which
  carries every `group.*` key at `organization` — the contrast check.
- Seed: `bun scripts/qa-tenant.ts EDU-GRP-05 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/group/users from
  `tenantKey('qa/cases/EDU-GRP-05.md', 'EDU-GRP-05#<suffix>', 'qa-shared')` +
  `tenantId(key, entity)`. The spec reads the ids through `loadTenant('EDU-GRP-05')`.
- The spec never writes: it only attempts the four group write endpoints and asserts they
  are rejected, so the tenant is left exactly as seeded and re-runs on one seeded tenant
  (CI `--retries=2`) stay deterministic.
