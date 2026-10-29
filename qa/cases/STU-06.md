# STU-06 — Sesja nauki – skróty klawiaturowe

- id: STU-06
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Nauka fiszek – „Ucz się” (algorytm SM-2)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Rozpoczęta sesja nauki.

## Steps

1. Naciśnij Spację.
2. Naciśnij klawisze 1, 2, 3, 4 na kolejnych fiszkach.
3. Sprawdź panel/toast skrótów.

## Expected result

- Spacja odwraca fiszkę (przód ⇄ tył).
- 1 = Nie pamiętam, 2 = Trudne, 3 = Dobrze, 4 = Łatwe; klawisze oceniają tylko po odsłonięciu odpowiedzi.
- Widoczny toast „Skróty: Spacja – odkryj, 1-4 – ocena” lub panel skrótów.

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`student1@dev.local`, password `pass`,
organization WSB Merito, group O1G1, personal deck `O1S1`). The suite version uses the case's
own tenant and never the legacy account.

- Profile: `content` (`qa/tests/profiles/STU-06.json`) — one organization, one default group
  `G1`, and one account per account type: `manager`, `teacher`, `student`. The spec signs in
  as `student`.
- Seed: `bun scripts/qa-tenant.ts STU-06 --fresh` — a fresh run suffix per independent run, so
  every run gets its own org/group/users from
  `tenantKey('qa/cases/STU-06.md', 'STU-06#<suffix>', 'qa-shared')` + `tenantId(key, entity)`.
  The spec reads the ids through `loadTenant('STU-06')`.
- Content (created by the spec through the product API, idempotently): one personal deck of the
  student — the `O1S1` analogue — with five new cards, so the „Ucz się” page offers exactly
  those new cards and the session queue is deterministic. The deck name carries the tenant's
  run suffix, so two independent runs never share already-studied cards.
- Prerequisite „Rozpoczęta sesja nauki”: the spec opens `/app/study` („Ucz się”) and starts the
  new-card session from there, exactly as a student would.
- Shortcuts panel: the session renders a panel (keyboard icon at the bottom, toggled with
  Alt+K) listing Space and 1–4 with their actions. The `shortcut_toast` string exists in the
  message catalogs but is not rendered anywhere, so the case's „toast … lub panel skrótów”
  branch is satisfied by the panel; no missing-toast defect is recorded.
- Rating labels: cards in the `learning` review state render the longer variants
  („Nie pamiętam (reset)”, „Trudne (zostań)”, „Dobrze (dalej)”, „Łatwe (zakończ)”), so the
  spec asserts the case's base labels as prefixes and the 1–4 mapping through the practice
  badge and the `batch/practice` payload.
