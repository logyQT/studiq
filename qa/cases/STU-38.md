# STU-38 — Kartkówka cudzej grupy – brak dostępu

- id: STU-38
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Kartkówki studenta (/app/assignments)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Kartkówka skierowana do innej grupy.

## Steps

1. Skopiuj URL kartkówki z innej grupy i otwórz jako student spoza grupy.

## Expected result

- Komunikat „Nie znaleziono kartkówki” (brak danych i brak możliwości startu).

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`student1@dev.local` in group
`O1G1`, password `pass`). The suite version uses the case's own tenant and never the
legacy accounts.

- Profile: `content` (`__tests__/qa/profiles/STU-38.json`) — one organization, one default
  group `G1` (holding the student and the teacher), and one account per account type:
  `manager` (org `admin`, the only role entitled to `group.manage`), `teacher` (account
  type `educator`, org `member` — the „T1” analogue that owns the assignment), and
  `student` (org `member`, in `G1` — the „S1” analogue that is outside the other group).
- Seed: `bun scripts/qa-tenant.ts STU-38 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/group/users from
  `tenantKey('qa/cases/STU-38.md', 'STU-38#<suffix>', 'qa-shared')` + `tenantId(key, entity)`.
  The spec reads the ids through `loadTenant('STU-38')`.
- The active organization is required: both the group and the assignment routes scope
  writes to `ctx.activeOrgId`, which is the tenant org from `loginAs`.
- The prerequisite „Kartkówka skierowana do innej grupy” is built inside this tenant
  through the product API, because the seeder's `content` profile ships a single group:
  1. the tenant manager creates a second group of the same organization
     (`STU-38 inna grupa`) and makes the tenant teacher its teacher member — the group
     picker/`GET /api/v1/organization/groups` only offers teacher-led groups;
  2. the tenant teacher creates one question and two published assignments from it —
     the „foreign” one targeted at that second group only, and a control one targeted
     at the student's own `G1`.
     The second group is looked up by name and reused, so a retry on the same tenant never
     grows the org past its group limit; every assignment id comes from those API calls.
- Isolation: the spec reads/writes no global admin setting, feature flag, plan, platform
  stat or singleton row, and does not touch another tenant.

## Observed during the suite walk (shared app 3010 / DB 54421, worker qa-env-7, pl)

- `/app/assignments` renders „Moje kartkówki” / „Wykonaj przypisane kartkówki”; only the
  assignment addressed to the student's own group is listed („OCZEKUJĄCE (N)”), the
  other group's assignment has no card and no link.
- Opening `/app/assignments/<id>` of the other group's published assignment renders
  „Nie znaleziono kartkówki”: the page settles on the message only, with no title, no
  „Pytania”/„Punkty” cards and no „Rozpocznij kartkówkę” action — exactly the case's copy
  and the intended „brak danych i brak możliwości startu”.
- The API agrees with the page: `GET /api/v1/assignments/<id>` answers
  404 `NOT_FOUND` and `POST /api/v1/assignments/<id>/start` answers 404 `NOT_FOUND`, so
  no attempt is created and the assignment never appears in `GET /api/v1/assignments`.
- Adjacent regression confirmed on the same session: the assignment addressed to the
  student's own `G1` opens normally (`h1` with its title and the „Rozpocznij kartkówkę”
  button), so the not-found page is caused by the audience, not by a broken student
  session.
