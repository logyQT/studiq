# EDU-QZ-05 — Utworzenie kartkówki z quizu

- id: EDU-QZ-05
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Quizy – kreator (/edu/quizzes)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Quiz z pytaniami.

## Steps

1. W edytorze lub szczegółach quizu kliknij „Utwórz kartkówkę”.

## Expected result

- Przejście do formularza nowej kartkówki z wczytanym quizem (pytania skopiowane do kartkówki).

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`teacher-classroom@dev.local`, password
`pass`, organization „Classroom”, quizy „Historia — Średniowiecze” / „Geografia i Nauka —
Odkrycia”). The suite version uses the case's own tenant and never the legacy accounts.

- Profile: `content` (`__tests__/qa/profiles/EDU-QZ-05.json`) — one organization, one default
  group `G1`, and one account per account type: `manager` (org `admin`), `teacher` (account
  type `educator`, org `member` — the „TC” analogue that owns the quiz), `student`.
- Seed: `bun scripts/qa-tenant.ts EDU-QZ-05 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/group/users from
  `tenantKey('qa/cases/EDU-QZ-05.md', 'EDU-QZ-05#<suffix>', 'qa-shared')` +
  `tenantId(key, entity)`. The spec reads the ids through `loadTenant('EDU-QZ-05')`.
- The active organization is required: quizzes are strictly org-scoped
  (`quizzes.organization_id` is NOT NULL and `POST /api/v1/teacher/quizzes` rejects a caller
  without a verified active org), and the route only admits account type `educator`, which is
  exactly the tenant's `teacher`.
- Prerequisite „Quiz z pytaniami” is built by the spec through the same product endpoints the
  UI calls, as the tenant teacher: bank „EDU-QZ-05 bank” with three multiple-choice questions
  („EDU-QZ-05 pytanie 1..3”, 1 pkt each) and quiz „EDU-QZ-05 quiz” holding those three
  questions in that order. The bank/questions/quiz are reused when an earlier run already
  created them (a retry on the same tenant starts from the same fixture) and recreated only
  when their content no longer matches. Leftover assignments titled „EDU-QZ-05 quiz” from an
  interrupted run are deleted first, so every run starts from zero assignments.
- Isolation: the spec reads/writes no global admin setting, feature flag, plan, platform stat
  or singleton row, and does not touch another tenant. Every row it creates carries this
  tenant's `organization_id` and the tenant teacher's `created_by`.

## Observed during the suite walk (shared app 3010 / DB 54421, worker qa-env-3, pl)

- The quiz editor (`/edu/quizzes/<id>/edit`) has no „Utwórz kartkówkę” action; the quiz detail
  page (`/edu/quizzes/<id>`) does, next to „Edytuj” and „Usuń”. The case's step allows either
  location („W edytorze **lub** szczegółach quizu”), so the detail page is the confirmed entry
  point and the walk/assertions start there. Recorded as a copy/scope note, not a defect.
- The quiz detail page shows the quiz name as `h1`, the counters „Pytania” / „Suma punktów”,
  and one card per question with its type badge (`mcq`) and points (`1 pts`).
- „Utwórz kartkówkę” is a link to `/edu/assignments/new?quizId=<quiz id>`; the form opens as
  „Nowa kartkówka” („Utwórz nową kartkówkę dla uczniów”) with the title already filled with the
  quiz name and the hint „Na podstawie: <quiz name>”. All other fields keep their defaults
  (empty description, empty deadline, no time limit, „Maks. prób” `1`, empty passing score,
  „Losuj pytania” / „Losuj odpowiedzi” on, „Pokaż wyniki” off).
- Saving navigates to `/edu/assignments/<id>`: the title as `h1`, the badge „Szkic”, the
  counters „Pytania” `3` / „Suma punktów” `3`, the three copied questions in the quiz's order
  with their type badge and `1 pts`, and the „Zobacz quiz źródłowy” link back to the quiz.
- The created assignment stores `quiz_id` and copies `quiz_questions` (`question_id`,
  `order_index`, `points`) into `assignment_questions`; deleting the quiz would only null the
  link (`ON DELETE SET NULL`), the copied questions are independent rows.
