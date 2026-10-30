# MGR-INV-03 — Anulowanie zaproszenia

- id: MGR-INV-03
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Zaproszenia (/manage/invites)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Oczekujące zaproszenie.

## Steps

1. Kliknij „Anuluj” w wierszu zaproszenia; w oknie „Anulować zaproszenie?” potwierdź.
2. Spróbuj użyć wcześniej skopiowanego linku /join?token=….

## Expected result

- Toast „Zaproszenie anulowane”, wiersz znika z listy oczekujących.
- Link zaproszenia przestaje działać (nieprawidłowy token – ONB-09).

## Prerequisite context (tenant model)

The automated case never uses the manual seed (`manager@dev.local`, `pass`). It owns a
seeded tenant instead:

- **Tenant key**: `tenantKey('qa/cases/MGR-INV-03.md', 'MGR-INV-03 cancel a pending invitation', 'qa-shared')`
  plus a per-run suffix (`QA_RUN_SUFFIX`, otherwise fresh). Every org/user/role id is
  `tenantId(key, entity)`.
- **Organization**: one org with the default group; the seeded `manager` is its `admin`.
- **Invitee**: only an address (`seed-educator-<hash>@dev.local`) — no account is created,
  because the case never accepts the invitation.
- **Invitation**: one live invitation for the invitee, role `teacher`, minted by the
  `manager` through `POST /api/v1/organization/invites` (the same request the page makes),
  so the target role, the inviter authority and the 7-day expiry are real. Its
  `inviteLink` is the `/join?token=…` link the case copies.
- **Profile**: no content (`content` graph minus decks/banks/quizzes); the case only
  touches the invites surface.
- The spec seeds the graph at run time with the shared helpers
  (`__tests__/helpers/tenant-seed.ts`) because every independent run needs an uncancelled
  invitation and its own org.

## Walk observations (qa-env-5, shared app 3010 / DB 54421, pl)

- `/manage/invites` („Zaproszenia”) shows the „Zaproś członków” card and the „Wysłane
  zaproszenia” table with columns E-mail / Rola / Status / Wysłano / Akcje. The pending
  row carries the badge „Oczekujące”, the role select shows the role display name
  („Teacher”), the date is `DD.MM.YYYY` and the ghost destructive action is „Anuluj”.
- „Anuluj” opens a Radix **alertdialog**: title „Anulować zaproszenie?”, description
  „Spowoduje to anulowanie zaproszenia. Osoba nie będzie mogła dołączyć.”, buttons
  „Zamknij” (dismiss) and „Anuluj” (confirm). The row trigger and the confirm button share
  the label „Anuluj”, so the spec scopes the confirm button to the dialog.
- „Zamknij” closes the window and leaves the invitation pending — nothing is cancelled.
- Confirming shows the toast „Zaproszenie anulowane”, the row leaves the table and the
  empty state „Brak wysłanych zaproszeń” appears. The row is deleted, not flagged: the
  pending list (`GET /api/v1/organization/invites?isAccepted=false`) no longer returns it.
- Before cancellation the copied link (`/join?token=…`, anonymous session) renders the
  join form „Dołącz do organizacji” with the invited address pre-filled and read-only and
  the „Aktywuj konto” button. After cancellation `GET /api/v1/organization/invites?token=…`
  answers **404**, the join screen shows the toast „Nieprawidłowy lub wygasły kod
  zaproszenia” and redirects to `/register`, where the only form is the plain registration
  page (no invitation prefill) — i.e. the invalid-token behaviour ONB-09 describes.
- Out of scope, noticed during the walk: when `/manage/invites` is the **first** page
  loaded right after a login that has no active-organization cookie yet, the roles and
  invitations requests fire before the shell's org switch and get `403`; the page then
  renders an empty list even though a pending invitation exists, until it is reloaded.
  The spec therefore enters the page the way a user does (login → `/manage` dashboard →
  „Zaproszenia” in the sidebar), which settles the active org first. The deep-link race is
  a separate concern for MGR-INV-01 triage, not part of this case.
