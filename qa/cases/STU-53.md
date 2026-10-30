# STU-53 — Powiadomienia (centrum powiadomień w nagłówku)

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

- Pozycja istnieje; kliknięcie zamyka menu i otwiera dzwonek powiadomień w nagłówku
  (popover „Powiadomienia”), bez przejścia na inną stronę. Potwierdź brak błędu.

## Prereqs (tenant model)

The case was written against the legacy manual seed (`student1@dev.local`, password
`pass`). The suite version uses the case's own tenant and never the legacy accounts.

- Profile: `content` (`__tests__/qa/profiles/STU-53.json`) — one organization, one default
  group `G1`, and one account per account type: `manager` (org `admin`), `teacher` and
  the `student` under test.
- Seed: `bun scripts/qa-tenant.ts STU-53 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/users from
  `tenantKey('qa/cases/STU-53.md', 'STU-53#<suffix>', 'qa-shared')` + `tenantId(key, entity)`.
  The spec reads the ids through `loadTenant('STU-53')`.
- `student1` → the tenant `student`, who signs in at `/app` and opens the user menu. The
  teacher and manager accounts pin that the shared menu offers the entry on `/edu` and
  `/manage` too.
- Nothing global is read or written — no admin setting, feature flag, plan, platform
  stat or singleton row — and no other tenant is touched. Opening the menu and the bell
  only reads, so CI's retries and `--repeat-each` passes can reuse the same seeded tenant.

## Product decision that superseded the expected result (#280), and its reversal (#664)

The expected result above predates the product decision of **2026-10-25** (issue #280,
closed as completed; fix #596 „hide dead Powiadomienia entry from the user menu”). The
menu entry was a dead link — it had no destination and only closed the menu — so it was
hidden for every role until a notifications surface exists.

**#664 builds that surface**, so the entry is back with a real destination: the bell in
the dashboard header opens a popover with the latest notifications, an unread badge and
„Oznacz wszystkie jako przeczytane”. The spec therefore asserts the case's original
outcome again — the entry exists for every dashboard role and selecting it opens the
bell in place — plus the shipped entries around it.

The entry is only rendered where the bell is mounted (`notifications` prop on the shared
menu, passed from the dashboard `UserMenu`), so the public pages keep the menu without it.

## Walk observations (shared app 3010 / DB 54421, worker qa-env-7, pl, 2026-10-29)

- The user menu is the sidebar-footer button (user name + e-mail); it is the same
  component on `/app`, `/edu` and `/manage`.
- It opens „Wybierz plan”, „Konto”, „Płatności”, „Powiadomienia”, the „Język” row with
  its select (#634), the „Motyw” three-position switch (#635) and „Wyloguj się”.
- Selecting „Powiadomienia” closes the menu and opens the header bell popover
  („Powiadomienia”) on the same URL; Escape closes it. The dropdown's close-focus
  return is skipped for this one selection so the popover is not dismissed as a
  focus-outside (CodeRabbit finding on #677).
- „Konto” still opens `/app/account` (teacher `/edu/account`, manager `/manage/account`)
  and closes the menu; no uncaught page error during the walk.
- Source: `user-menu-content.tsx` renders the entry only when `notifications` is set;
  `user-menu.tsx` passes it from the dashboard menu and owns the focus handling.
