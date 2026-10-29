# STU-53 — Powiadomienia (funkcja niezaimplementowana)

- id: STU-53
- priority: P3 kosmetyczny
- module: STU – Panel studenta (/app)
- section: Konto studenta (/app/account)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany student1.

## Steps

1. W menu użytkownika kliknij „Powiadomienia”.

## Expected result

- Pozycja istnieje; kliknięcie tylko zamyka menu (brak ekranu powiadomień). Potwierdź brak błędu – funkcja w przygotowaniu.

## Prereqs (tenant model)

The case was written against the legacy manual seed (`student1@dev.local`, password
`pass`). The suite version uses the case's own tenant and never the legacy accounts.

- Profile: `content` (`qa/tests/profiles/STU-53.json`) — one organization, one default
  group `G1`, and one account per account type: `manager` (org `admin`), `teacher` and
  the `student` under test.
- Seed: `bun scripts/qa-tenant.ts STU-53 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/users from
  `tenantKey('qa/cases/STU-53.md', 'STU-53#<suffix>', 'qa-shared')` + `tenantId(key, entity)`.
  The spec reads the ids through `loadTenant('STU-53')`.
- `student1` → the tenant `student`, who signs in at `/app` and opens the user menu. The
  teacher and manager accounts are only used for the „no entry for any role” regression
  (the menu is one shared component).
- Nothing global is read or written — no admin setting, feature flag, plan, platform
  stat or singleton row — and no other tenant is touched. Opening the menu writes
  nothing, so CI's retries and `--repeat-each` passes can reuse the same seeded tenant.

## Product decision that supersedes the expected result (issue #280)

The expected result above predates the product decision of **2026-10-25** (issue #280,
closed as completed; fix #596 „hide dead Powiadomienia entry from the user menu”). The
menu entry was a dead link — it had no destination and only closed the menu — so it was
hidden for every role until a notifications surface exists. #280's acceptance criteria
are: **no „Powiadomienia” entry for any role, the future notification spec captured in a
TODO next to the menu definition, and no other menu item changes.** The spec therefore
asserts that intended behaviour (no entry, all shipped entries intact) instead of the
case's „Pozycja istnieje”.

The feature itself is still „w przygotowaniu”: `/app/notifications` answers 404 and
„In-app notification center” is still an open roadmap item (#664). That absence is not
asserted — the durable contract is that no dead entry is rendered while the surface does
not exist.

## Walk observations (shared app 3010 / DB 54421, worker qa-env-7, pl, 2026-10-29)

- The user menu is the sidebar-footer button (user name + e-mail); it is the same
  component on `/app`, `/edu` and `/manage`.
- For the student, the teacher and the manager it opens exactly seven entries:
  „Wybierz plan”, „Konto”, „Płatności”, „Polski”, „English”, „Motyw”, „Wyloguj się” —
  no „Powiadomienia” (and no English „Notifications”) row, and no menu row mentions
  notifications at all.
- Escape closes the menu and leaves the dashboard URL unchanged — the case's „kliknięcie
  tylko zamyka menu” outcome is now the only possible one, with no error.
- „Konto” still opens `/app/account` (teacher `/edu/account`, manager `/manage/account`)
  and closes the menu; no uncaught page error during the walk.
- `/app/notifications` is not a route: `GET` returns 404.
- Source: `user-menu-content.tsx` — the entry block is a TODO comment (hidden in #280)
  next to the shared menu list, so both the dropdown and the plain/mobile variant omit it.
