# MGR-SET-02 — Wgranie logo (plan z brandingiem)

- id: MGR-SET-02
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Ustawienia i branding (/manage/settings)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Organizacja na planie Hub/Campus lub z override branding. Plik logo.png < 1 MB.

## Tenant fixture (QA-suite)

The legacy `manager@dev.local` + WSB Merito seed is replaced by this case's own
`content` tenant:

- `bun scripts/qa-tenant.ts MGR-SET-02 --fresh` creates the organization
  `qa-mgr-set-02-<run-suffix>` with a manager, an educator, a student and the
  default group; every id derives from
  `tenantKey('qa/cases/MGR-SET-02.md', 'MGR-SET-02#<run-suffix>', 'qa-shared')`.
- "Plan z brandingiem / override branding": the spec grants the tenant's own
  `org_role_features` rows the `branding` key (the per-org entitlement override
  the resolver treats as authoritative). The shared plan catalog and
  `feature_flags` are never read or written, so no other worker's org or global
  admin state is involved.
- Logo fixture: a deterministic 1×1 PNG uploaded through the real "Wgraj logo"
  file chooser. The spec clears its own org's previous `logo_url` (and storage
  object) first, so every run starts from "Brak logo" without a reseed.

## Steps

1. Kliknij „Wgraj logo” i wybierz logo.png.
2. Obserwuj przełącznik organizacji w pasku bocznym.
3. Odśwież stronę.

## Expected result

- Toast „Logo zaktualizowane”; podgląd logo 48×48 w ustawieniach.
- Logo widoczne w przełączniku organizacji (zamiast awatara) bez przeładowania.
- Po odświeżeniu zachowane.
