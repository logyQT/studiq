# EDU-ASG-10 — Wydruk kartkówki i klucz odpowiedzi

- id: EDU-ASG-10
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Kartkówki (/edu/assignments)
- prereqs: none (self-contained tenant — see Seed)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Kartkówka z pytaniami.

## Seed (QA-suite)

- Tenant: the case's own `content` tenant (`__tests__/qa/profiles/EDU-ASG-10.json`), seeded with
  `bun scripts/qa-tenant.ts EDU-ASG-10 --fresh` — one fresh run suffix per independent run.
  All ids come from `tenantKey('qa/cases/EDU-ASG-10.md', 'EDU-ASG-10#<run>', 'qa-shared')` +
  `tenantId(key, entity)`.
- Account: the tenant's `users.teacher`
  (`loginAs(page, tenant, 'teacher', { locale: 'pl' })`). No legacy/manual account
  (`teacher-classroom@dev.local`, `pass`) is used.
- Organization: `qa-edu-asg-10-<suffix>` with a manager, an educator and a student, plus the
  default group `G1`; the educator's active org is the tenant org.
- Content: the spec builds the prerequisite through the product API — one personal bank with
  one multiple-choice, one true/false and one open question, attached to a fresh draft
  assignment („Kartkówka wydruk …”). Bank and questions are found-or-created per run, so a CI
  retry on the same tenant reuses them instead of spending the educator's
  `max_question_banks` / `max_questions` quota.
- Print settings: stored device-side in `localStorage` under `assignment-print-settings` (the key
  the „Ustawienia drukowania” page writes). Each test starts from an empty browser context, so
  the documented defaults (every field on) apply; the second test turns all five switches off on
  `/edu/assignments/settings` and saves before printing.
- Nothing shared is read or written: no admin setting, feature flag, plan, platform stat or
  singleton row, and no other tenant.
- UI notes (walk on the shared app, Polish UI): the detail page offers „Drukuj” in the header and
  „Drukuj pusty test” in the „Akcje” card once the assignment has questions; both open
  `/edu/assignments/<id>/print`. The view shows „Ta strona jest zoptymalizowana do druku. Użyj
  Ctrl+P (Cmd+P), aby zapisać jako PDF.”, „Imię i nazwisko:” / „Klasa:” / „Data:”, „1 pkt” next to
  each question, choice bubbles (mcq), checkboxes (true/false) and three answer lines for the
  open question. „Klucz odpowiedzi” lists the correct option per question and marks the open one
  „(pytanie otwarte)”. Emulated print media hides the hint, the dashboard sidebar and the header,
  and forces the key onto its own page (`break-before: page`); `page.pdf()` produces a two-page
  PDF. Doubled colons (#195) and dashboard chrome / a one-page key (#194) are fixed in the build
  under test.

## Steps

1. Kliknij „Drukuj” / „Drukuj pusty test”.
2. Sprawdź obecność pól „Imię i nazwisko”, „Klasa”, „Data”, punkty przy pytaniach i klucz odpowiedzi.
3. Użyj Ctrl+P → „Zapisz jako PDF”.

## Expected result

- Widok zoptymalizowany do druku z podpowiedzią „Użyj Ctrl+P…”.
- Elementy pól na wydruku zgodne z ustawieniami drukowania; pytanie otwarte oznaczone „(pytanie otwarte)”.
- Klucz odpowiedzi na osobnej stronie, jeśli włączony.
