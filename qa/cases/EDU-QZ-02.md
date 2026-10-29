# EDU-QZ-02 — Dodawanie pytań do quizu

- id: EDU-QZ-02
- priority: P1 krytyczny
- module: EDU – Panel nauczyciela (/edu)
- section: Quizy – kreator (/edu/quizzes)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Edytor quizu.

## Seed (tenant model)

Legacy accounts (`teacher-classroom@dev.local`, password `pass`) are never used.
The case runs in its own deterministic tenant, declared in
`qa/tests/profiles/EDU-QZ-02.json` (`{ "profile": "content" }`):

```bash
bun scripts/qa-tenant.ts EDU-QZ-02 --fresh
```

- tenant key: `tenantKey('qa/cases/EDU-QZ-02.md', 'EDU-QZ-02#<suffix>', 'qa-shared')`
- org `qa-edu-qz-02-<suffix>` with a manager, an educator and a student, plus the
  default group `G1`
- the educator logs in through the real `/api/v1/auth/login` (fixture password
  `Seed4Test!`) with `active_org_id` set to the tenant org

The case's own prerequisite — a quiz in the editor and a few questions to choose
from — is built inside the tenant through the product API by the spec, so a
retry against the same tenant (CI seeds once and retries) reuses the same bank,
questions and quiz, and resets the quiz to empty before the walk.

## Steps

1. Open the quiz editor (`/edu/quizzes/<id>/edit`). On desktop the question
   browser is the docked card titled „Dodaj pytania” on the right; add a question
   from it with the „+” control (`title="Dodaj do quizu"`). (On narrow viewports
   the same browser opens from the „Dodaj pytania” button as a dialog; the drag
   step below requires the docked desktop panel.)
2. Drag a question from the „Dodaj pytania” list (grip handle) into the quiz
   (drag & drop).
3. Try to add an already-added question again — it is no longer offered in the
   browser.

## Expected result

- Pytania pojawiają się w quizie z domyślnymi punktami 1.
- Dodane już pytania są oznaczone/ukryte w przeglądarce (nie można duplikować).
- Łączna liczba punktów („Suma punktów”) aktualizuje się.

## Walk observations (shared app, worker qa-env-2)

- Editor title: „Edytuj quiz”; breadcrumb „Panel Nauczyciela › Quizy › <nazwa> ›
  Edytuj quiz” (the quiz name, never the raw UUID).
- Empty quiz: „Brak pytań” / „Dodaj pytania do tego quizu”; footer
  „0 pytań · Suma punktów: 0”.
- Docked browser: heading „Dodaj pytania”, bank select („Wszystkie banki”), search
  „Szukaj pytań...”, one card per question with type badge (`open`) and a „+”
  control.
- Adding with „+”: row „1. <treść>” with a points input (`aria-label="Punkty za
pytanie 1"`, step 1, default `1`) and the unit „pkt”; footer becomes
  „1 pytanie · Suma punktów: 1” and „Niezapisane zmiany” appears until the save.
- Drag & drop from the browser grip onto an existing row inserts the question,
  keeps points at `1`, increments the footer and hides it from the browser
  immediately.
- With all questions added the browser shows „Nie znaleziono pytań”; an added
  question (and its „+”) is absent, so it cannot be duplicated.
- „Zapisz” fires `PUT /api/v1/teacher/quizzes/<id>/bulk`, shows the toast
  „Zapisano”, and a reload keeps the rows, their `1` points and
  „N pytań · Suma punktów: N”. The stored `quiz_questions` rows have
  `points: 1` and contiguous `order_index` values.
- No browser console errors during the walk.
