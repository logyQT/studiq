# STU-18 — Usunięcie talii

- id: STU-18
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Talie (/app/flashcards)
- prereqs: none (self-contained tenant — see Seed)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Własna talia (utwórz tymczasową).

## Seed (QA-suite)

- Tenant: the case's own `content` tenant (`__tests__/qa/profiles/STU-18.json`), seeded
  with `bun scripts/qa-tenant.ts STU-18 --fresh` — one fresh run suffix per
  independent run. All ids come from
  `tenantKey('qa/cases/STU-18.md', 'STU-18#<run>', 'qa-shared')` +
  `tenantId(key, entity)`.
- Account: the tenant's `users.student`
  (`loginAs(page, tenant, 'student', { locale: 'pl' })`). No legacy/manual account
  (`student1@dev.local`, `pass`) is used.
- Organization: `qa-stu-18-<suffix>` with a manager, an educator and the student as
  a member, plus the default group `G1`. The student's active org is the tenant org.
- Content: the spec creates one temporary personal deck through
  `POST /api/v1/flashcards/decks` inside that active org, so the list endpoint
  returns it. Nothing shared is read or written: no global admin setting, feature
  flag, plan, platform stat or singleton row, and no other tenant.
- UI note (walk on the shared app, Polish UI): the deck card's kebab menu is labelled
  „Więcej akcji: <nazwa talii>”; its destructive entry „Usuń” opens the dialog
  „Usunąć talię?” with the description „To trwale usunie talię. Tej akcji nie można
  cofnąć.” and the buttons „Anuluj” / „Usuń”. After deletion the toast „Talia
  usunięta” appears and the counter reads „0 talii”.

## Steps

1. Wybierz „Usuń” w menu talii.
2. Najpierw kliknij „Anuluj”, potem powtórz i potwierdź.

## Expected result

- Okno „Usunąć talię?” – „To trwale usunie talię. Tej akcji nie można cofnąć.”.
- „Anuluj” nic nie usuwa. Potwierdzenie → toast „Talia usunięta”, talia znika.
