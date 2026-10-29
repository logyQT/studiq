# STU-34 — Lista kartkówek

- id: STU-34
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Kartkówki studenta (/app/assignments)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Opublikowana kartkówka dla klasy (patrz EDU-ASG-…). Zalogowany student-classroom.

## Seed — tenant model (reconciled with the suite seeder)

The legacy prerequisite names the manual seed account `student-classroom@dev.local`
(password `pass`, organization „Classroom”, group „Classroom Group”) and expects a quiz
published for that class by `teacher-classroom@dev.local`. The automated case never uses
those accounts; it runs on its own tenant:

```bash
bun scripts/qa-tenant.ts STU-34 --fresh
# __tests__/qa/profiles/STU-34.json → "content"
```

That gives the student under test its own organization `qa-stu-34-<run suffix>` with a
manager (org `admin`), an educator and the student (org `member`), plus the default group
`G1`; every id derives from `tenantKey('qa/cases/STU-34.md', 'STU-34#<suffix>',
'qa-shared')` + `tenantId(key, entity)`. The student is a member of `G1`, so a quiz
targeted at `G1` reaches it like „Classroom Group” did in the manual seed.

The `content` profile seeds only the graph, so the spec builds the case's prerequisite
inside this tenant through the product API (nothing shared is read or written):

- „STU-34 grupowa” — 2 mcq questions (1 point each), deadline +3 days, time limit 10 min,
  max attempts 1, published to `G1`; the student uses it up so it lands under
  „Ukończone (N)”;
- „STU-34 indywidualna” — 1 question, deadline +5 days, max attempts 2, published to the
  student directly; the student starts it and leaves, so it lands under „W trakcie”;
- „STU-34 obca grupa” — 1 question, published to a second group of the same organization
  that has no members — the isolation counterpart the student must never see;
- „STU-34 szkic” — a draft targeted at `G1` but never published, also invisible.

The second group needs `group.manage`, which the tenant educator does not have (its org
role is `member`), so the spec creates it as the tenant's manager. Nothing global is
touched: no admin setting, feature flag, plan, platform stat or singleton row.

## Steps

1. Otwórz /app/assignments.

## Expected result

- Sekcje „Oczekujące (N)”, „W trakcie”, „Ukończone (N)” z terminem, liczbą pytań, punktami.
- Pusty stan: „Brak kartkówek – Nie masz oczekujących kartkówek od nauczycieli”.
- Student widzi tylko kartkówki skierowane do jego grup/jego samego.

## Observations from the walk (shared app, Polish UI, 2026-10-29)

- `/app/assignments` is „Moje kartkówki” („Wykonaj przypisane kartkówki”). With no
  assignments it shows the empty state „Brak kartkówek” / „Nie masz oczekujących
  kartkówek od nauczycieli” and renders no section at all (the „first visit” hint above it
  is not part of the empty state). The heading text is CSS-uppercased, so the DOM text is
  „Oczekujące (N)” / „Ukończone (N)”, not the all-caps form.
- A pending card carries the title, a badge with „N pytań · M punktów” (Polish plurals:
  „1 pytanie · 1 punkt”, „2 pytania · 2 punkty”), the optional description, and the row
  „Termin: <d.m.yyyy>”, plus „<min> min” when a time limit is set and „Pozostało prób:
  left/total” when max attempts > 1.
- Sections are conditional: a zero-count section is not rendered, so after the student
  starts the only pending quiz the „Oczekujące (1)” section disappears.
- A started attempt leaves „Oczekujące” and renders its own „W trakcie” section (no
  counter in the heading) — this is the fixed behaviour from issue #368; the card keeps
  the same question/point/deadline data. The attempt budget counts completed attempts
  only, so an open attempt does not change „Pozostało prób”.
- A quiz whose attempts are used up moves to „Ukończone (N)”: the card then shows the
  score „score/points” („2/2” for two full-point questions) and „Ukończono: <d.m.yyyy>”
  instead of the deadline/question badge. That is the intended layout from issue #366 —
  points were added to the pending/in-progress/scheduled/closed cards, not to the
  completed one.
- Isolation: a published quiz targeted at a group the student is not a member of, and an
  unpublished draft, are absent both from the page and from `GET /api/v1/assignments`.
