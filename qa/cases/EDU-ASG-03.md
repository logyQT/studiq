# EDU-ASG-03 — Dodawanie pytań – losowanie

- id: EDU-ASG-03
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Kartkówki (/edu/assignments)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Szkic kartkówki; bank z ≥ 6 pytaniami.

## Steps

1. Wybierz źródło: bank „Geografia i Nauka”, typy: WW i P/F, liczba: 3.
2. Kliknij „Losuj”, a następnie „Dodaj wylosowane”.
3. Ustaw liczbę 0 i spróbuj losować.

## Expected result

- Dodane zostaje dokładnie N pytań wybranych typów z wybranego źródła, bez duplikatów.
- Przy liczbie < 1 przycisk „Losuj” jest nieaktywny.

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`teacher-classroom@dev.local`, bank
„Geografia i Nauka” with 6 questions). The suite version uses the case's own tenant and never
the legacy accounts.

- Profile: `content` (`qa/tests/profiles/EDU-ASG-03.json`) — one organization, one default
  group `G1`, and one account per account type: `manager` (org `admin`), `teacher` (account
  type `educator`, org `member`), `student`.
- Seed: `bun scripts/qa-tenant.ts EDU-ASG-03 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/group/users from
  `tenantKey('qa/cases/EDU-ASG-03.md', 'EDU-ASG-03#<suffix>', 'qa-shared')` +
  `tenantId(key, entity)`. The spec reads the ids through `loadTenant('EDU-ASG-03')`.
- Prerequisite „szkic kartkówki; bank z ≥ 6 pytaniami”, created by the spec through the
  product API as the tenant teacher (idempotent, so a retry against the same tenant starts
  from the same state):
  - bank „EDU-ASG-03 bank” with exactly 6 questions — 2 × WW (`mcq`), 2 × P/F
    (`true_false`), 2 × otwarte (`open`); the 4 WW/P/F questions are the draw pool, the
    open ones prove the type filter narrows it;
  - one draft (`status: 'draft'`) assignment „EDU-ASG-03 kartkówka” with no questions yet.
- Both entities live inside this tenant (`organization_id` = the tenant org, `created_by` =
  the tenant teacher), so the draw pool is `organization_id = active org` and the assertion
  can never see another worker's questions. Nothing global is read or written: no admin
  setting, feature flag, plan, platform stat or singleton row.
- The tenant seeder enrolls the teacher with the org `member` role; `assignment.*` resolves
  to the educator default scope `own`, so the teacher owns the draft and the draw endpoint
  accepts it without any extra promotion.

## Walk notes (shared app, tenant `EDU-ASG-03#rmvtden4ddf4a`)

- The „Losuj” control on the assignment page is the trigger that opens the „Losuj” dialog.
  The dialog holds the source radios („Wszystkie pytania” / „Bank pytań” / „Temat”), the
  bank select, the type checkboxes („Wielokrotny wybór” / „Prawda/Fałsz” / „Otwarte”), the
  „Liczba” input and the draw action button „Dodaj wylosowane”.
- Copy note (P3, not a defect): the case's expected result says the „Losuj” button is
  inactive for a number below 1. The number only exists inside the dialog the „Losuj”
  trigger opens, so the control that can be disabled is the draw action
  „Dodaj wylosowane”; at „Liczba” 0 it is disabled, and the page-level „Losuj” trigger stays
  enabled because it only opens the dialog. The API enforces the same rule:
  `POST /api/v1/teacher/assignments/:id/randomize` with `count: 0` answers `422` with
  `VALIDATION_INVALID_TOO_SMALL` on `count`.
- Confirmed: count 3 with WW + P/F from the bank adds exactly 3 questions, all `mcq` /
  `true_false` and all from that bank. A second draw with the same filters adds only the one
  still-unused eligible question (4 of 4), never a duplicate.
