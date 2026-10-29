# EDU-GRP-05 — Brak funkcji group.manage

- id: EDU-GRP-05
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Grupy nauczyciela (/edu/groups)
- prereqs: tenant `content` (educator whose org role is `member` → no `group.manage`)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Wyłącz funkcję group.manage dla T1 w panelu admina (ADM-OVR) lub użyj konta bez tej funkcji.

## Steps

1. Odśwież panel nauczyciela.
2. Wejdź ręcznie na /edu/groups.

## Expected result

- Pozycja „Grupy” znika z menu.
- Operacje zapisu na grupach są odrzucane (403 FORBIDDEN) – brak niezabezpieczonych akcji.

## Observed on the shared app (walk, qa-env-1)

- The educator's sidebar has no „Grupy” entry (and no `a[href="/edu/groups"]` at all); the
  rest of the `/edu` nav (Przegląd / Talie / Tematy / Pytania / Testy / Kartkówki /
  Zgłoszenia / Treści / Wyniki / Aktywność) is unchanged, before and after a reload.
- `/edu/groups` stays reachable and renders a **read-only** list: heading „Grupy”, the
  seeded group with its real counts, the lock badge „Grupa utworzona przez kogoś innego —
  nie możesz jej edytować” and the report button. There is no „Nowa grupa”, no
  „Edytuj grupę”, no „Usuń grupę” and no member-management control.
- `POST /api/v1/organization/groups`, `PUT`/`DELETE /api/v1/organization/groups/:id` and
  `PUT /api/v1/organization/groups/:id/members` all answer `403` with
  `x-error-code: FORBIDDEN` and `{ "success": false, "error": "FORBIDDEN" }`; the group and
  its membership are unchanged afterwards.
- The route staying reachable (read-only) is not a contradiction of the case: the expected
  result only requires the menu entry to disappear and writes to be rejected, and
  `GroupService.listGroups` has no `group.manage` gate by design.
- Out of scope, recorded only: the `/edu` onboarding checklist still offers „Utwórz swoją
  pierwszą grupę” / „Zaproś pierwszych studentów” linking to `/edu/groups` for this
  educator. It is a link to the read-only page, not a write action, and the case does not
  cover the checklist — not asserted.

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`teacher1@dev.local`, password `pass`,
organization WSB Merito, group `O1G1`) and its prerequisite asked for an admin-panel
feature override (ADM-OVR) on that account. The suite version uses the case's own tenant and
never the legacy accounts, and it takes the prerequisite's second option — _„użyj konta bez
tej funkcji”_ — instead of mutating a global admin setting.

- Profile: `content` (`__tests__/qa/profiles/EDU-GRP-05.json`) — one organization with an
  `admin` manager, an org-`member` educator and an org-`member` student, plus the default
  group `G1` (all three enrolled, the manager as its group `teacher`).
- Why that profile: `group.manage` is an org-role entitlement, not a personal plan. The org
  trigger seeds `org_role_features` per role, and the `member` role only gets `flashcards`,
  `quiz`, `ai.chat`, `documents` and `branding` — so the `content` profile's educator is
  exactly „konto bez tej funkcji”, with no admin-panel override and no write to
  `user_feature_overrides`, `feature_flags` or any other global row. The manager of the same
  tenant keeps `group.manage` (org `admin`), which is what the spec's contrast check uses.
- Seed: `bun scripts/qa-tenant.ts EDU-GRP-05 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/group/users from
  `tenantKey('qa/cases/EDU-GRP-05.md', 'EDU-GRP-05#<suffix>', 'qa-shared')` +
  `tenantId(key, entity)`. The spec reads the ids through `loadTenant('EDU-GRP-05')`.
- The spec never writes: it only attempts the four group write endpoints and asserts they
  are rejected, so the tenant is left exactly as seeded and re-runs on one seeded tenant
  (CI `--retries=2`) stay deterministic.
- Not asserted: the second/third accounts beyond what the write attempts need — they exist
  because the `content` profile always creates manager + educator + student.
