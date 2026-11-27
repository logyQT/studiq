# MGR-SET-02 — Wgranie logo (plan z brandingiem)

- id: MGR-SET-02
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Ustawienia i branding (/manage/settings)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Amendment (2026-11-26, B2 #1493)

Since #1493 the organization ladder is cumulative and `branding` is the **Campus** tier. This
tenant's organization is on the seeder's default `launch` plan, so „Plan z brandingiem” is not its
plan: the uploader is not rendered and the logo route answers **403 FORBIDDEN** before type or size
validation. The case therefore checks the shipped locked state: `/manage/settings` shows the
„Własny branding” lock card in place of the uploader, and a valid PNG is refused with no row change.
Stored-values coverage lives in LIM-05/MGR-SET-04/05, which seed the row directly.

## Prerequisite (verbatim)

Organizacja na planie Hub/Campus. Plik logo.png < 1 MB.

Wariant „override branding” z dokumentu źródłowego nie istnieje po fazie 2a-1
(ADR-0015): klucz nie-markerowy rozstrzyga profil roli przecięty z pułapem planu,
więc warunkiem jest plan z brandingiem.

## Tenant fixture (QA-suite)

The legacy `manager@dev.local` + WSB Merito seed is replaced by this case's own
`content` tenant:

- `bun scripts/qa-tenant.ts MGR-SET-02 --fresh` creates the organization
  `qa-mgr-set-02-<run-suffix>` with a manager, an educator, a student and the
  default group; every id derives from
  `tenantKey('qa/cases/MGR-SET-02.md', 'MGR-SET-02#<run-suffix>', 'qa-shared')`.
- „Plan z brandingiem”: spec czyta plan organizacji tenanta i — gdy jej pułap
  (`plan_entitlements`) nie zawiera `branding` — przenosi **tę jedną** organizację na
  `hub` przez `change_org_plan`, ten sam RPC, który wywołuje webhook płatności.
  `branding` jest kluczem nie-markerowym, więc rozstrzyga go profil roli
  (`entitlement_profile = 'all'` roli `admin` managera) przecięty z pułapem planu;
  osobny magazyn uprawnień per rola już nie istnieje i nie jest tu używany.
  Wspólny katalog planów i `entitlement_flags` nie są zapisywane, więc żadna inna
  organizacja ani globalny stan admina nie jest ruszany.
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
