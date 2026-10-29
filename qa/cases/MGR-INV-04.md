# MGR-INV-04 — Akceptacja zaproszenia dla istniejącego użytkownika

- id: MGR-INV-04
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Zaproszenia (/manage/invites)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zaproszenie dla student3@dev.local.

## Prerequisite context (tenant model)

The verbatim prerequisite names the legacy manual seed (`student3@dev.local`, a
standalone B2C student with no organization, password `pass`). The automated case
owns a seeded tenant instead; the legacy accounts are never used.

- **Tenant key**: `tenantKey()` over `qa/cases/MGR-INV-04.md`, the title
  `MGR-INV-04 accepting an invite as an existing user` and project `qa-shared`,
  plus a per-run suffix (`QA_RUN_SUFFIX`, otherwise fresh). Org, group and account
  ids are `tenantId(key, entity)`; the e-mails are
  `qa+<shorthash>+<role>@test.local`.
- **Organization**: one org (`qa-mgr-inv-04-<suffix>`) with its default group
  `INV-04 G1`.
- **Users** (password `Seed4Test!`):
  - `manager` — manager account, `admin` org role, sole member of the org;
  - `invitee` (`student`) — an **existing registered account** that belongs to no
    organization, the tenant counterpart of S3. The spec creates it with
    `ensureAccount()` and deletes any leftover membership of this tenant's org, so
    the "already registered, not yet a member" state holds on every run.
- **Invitation**: created by the spec through `/manage/invites` for the invitee's
  address with the `teacher` role, so the expected "role from the invitation"
  differs from the organization's default `member`.
- The spec seeds the graph at run time with the shared helpers
  (`__tests__/helpers/tenant-seed.ts`) and deletes that tenant's previous
  invitations for the invitee, because every independent run needs its own
  unaccepted token.

## Steps

1. Zaloguj się jako student3, wejdź na /app/join i wklej token.
2. Jako manager sprawdź listę zaproszeń (zaakceptowane) i członków.

## Expected result

- Zaproszenie ma status „Zaakceptowane”, S3 widoczny wśród członków z rolą z zaproszenia.
- Ponowne użycie tego samego tokenu jest odrzucone.
