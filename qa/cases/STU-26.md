# STU-26 — Kopiowanie fiszki do innej talii

- id: STU-26
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Fiszki w talii (/app/flashcards/<id>)
- prereqs: none (self-contained tenant — see Seed)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Talie A i B.

## Seed (QA-suite)

- Tenant: the case's own `content` tenant (`qa/tests/profiles/STU-26.json`), seeded
  with `bun scripts/qa-tenant.ts STU-26 --fresh` — one fresh run suffix per
  independent run. All ids come from
  `tenantKey('qa/cases/STU-26.md', 'STU-26#<run>', 'qa-shared')` +
  `tenantId(key, entity)`.
- Account: the tenant's `users.student`
  (`loginAs(page, tenant, 'student', { locale: 'pl' })`). No legacy/manual account
  (`student1@dev.local`, `pass`) is used.
- Organization: `qa-stu-26-<suffix>` with a manager, an educator and the student as
  a member, plus the default group `G1`. The student's active org is the tenant org.
- Content: the spec creates „Talia A” and „Talia B”
  (`POST /api/v1/flashcards/decks`) and one flashcard in Talia A
  (`POST /api/v1/flashcards`) through the product API, inside the student's active
  org, so `/app/flashcards/<Talia A>` lists exactly that card and the copy dialog
  offers only Talia B. Nothing shared is read or written: no global admin setting,
  feature flag, plan, platform stat or singleton row, and no other tenant.
- Retry safety: CI seeds a tenant once and retries reuse it, so the spec first
  deletes this tenant's student decks (cascading their cards) — each attempt then
  starts from the same two-deck state instead of finding the previous attempt's
  decks in the copy dialog.
- UI note (walk on the shared app, 2026-10-29, Polish UI): the card's kebab is
  „Więcej akcji fiszki”; its entry „Kopiuj do Innej Talii” opens the dialog
  „Kopiuj Fiszkę do Innej Talii” („Nowa fiszka o tej samej zawartości zostanie
  utworzona w wybranej talii. Będą niezależne.”) with the other decks of the org,
  „Anuluj” / „Kopiuj do Talii” (disabled until a deck is picked) and no entry for
  the current deck. Copying shows the toast „Fiszka skopiowana pomyślnie” and the
  „Fiszka Skopiowana” dialog with „Przejdź do Nowej Fiszki” (primary) and „Zostań
  Tutaj” (outline). „Przejdź do Nowej Fiszki” opens the _target deck_ — the product
  has no per-card route, so the deck that now holds the copy is the deepest link —
  while „Zostań Tutaj” just closes the dialog and keeps the source deck.

## Steps

1. Wybierz „Kopiuj do Innej Talii”.
2. Wybierz talię B, kliknij „Kopiuj do Talii”.
3. W oknie wybierz „Przejdź do Nowej Fiszki” (w drugim podejściu „Zostań Tutaj”).
4. Edytuj kopię i oryginał niezależnie.

## Expected result

- Toast „Fiszka skopiowana pomyślnie”, okno „Fiszka Skopiowana” z dwiema opcjami.
- Kopia jest niezależna – zmiana oryginału nie wpływa na kopię.
