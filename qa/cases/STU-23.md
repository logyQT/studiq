# STU-23 — Edycja fiszki

- id: STU-23
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Fiszki w talii (/app/flashcards/<id>)
- prereqs: none (self-contained tenant — see Seed)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Talia z fiszką.

## Seed (QA-suite)

- Tenant: the case's own `content` tenant (`qa/tests/profiles/STU-23.json`), seeded
  with `bun scripts/qa-tenant.ts STU-23 --fresh` — one fresh run suffix per
  independent run. All ids come from
  `tenantKey('qa/cases/STU-23.md', 'STU-23#<run>', 'qa-shared')` +
  `tenantId(key, entity)`.
- Account: the tenant's `users.student`
  (`loginAs(page, tenant, 'student', { locale: 'pl' })`). No legacy/manual account
  (`student1@dev.local`, personal deck `O1S1`, `pass`) is used.
- Organization: `qa-stu-23-<suffix>` with a manager, an educator and the student as
  a member, plus the default group `G1`. The student's active org is the tenant org.
- Content: the spec creates one deck (`POST /api/v1/flashcards/decks`) and one
  flashcard in it (`POST /api/v1/flashcards`) through the product API, inside the
  student's active org, so `/app/flashcards/<id>` lists exactly that card. This is
  the case's „talia z fiszką”. Nothing shared is read or written: no global admin
  setting, feature flag, plan, platform stat or singleton row, and no other tenant.
- UI note (walk on the shared app, 2026-10-29, Polish UI): the card's kebab is
  labelled „Więcej akcji fiszki”; its entry „Edytuj” opens the dialog titled
  „Edytuj Fiszkę”, prefilled with the stored „Pytanie” and „Odpowiedź”, with the
  buttons „Anuluj” / „Aktualizuj”. Saving shows the toast „Fiszka zaktualizowana
  pomyślnie”, closes the dialog and the card shows the new content in place (no
  reload). An empty side is refused with „Zarówno przód jak i tył są wymagane” and
  the dialog stays open.

## Steps

1. W menu fiszki wybierz „Edytuj”, zmień treść, zapisz („Aktualizuj”).

## Expected result

- Toast „Fiszka zaktualizowana pomyślnie”; zmiany widoczne od razu.
