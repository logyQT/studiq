# STU-43 — Statystyki – „Wyniki” (quizy)

- id: STU-43
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Statystyki studenta (/app/stats/results)
- prereqs: none (self-contained tenant — see Prereqs)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Konto SC po kilku quizach.

## Steps

1. Otwórz /app/stats/results.

## Expected result

- Historia testów z wynikiem (%), datą i etykietą „Podejście”.
- Konto bez quizów: „Brak podejść do testów”.

## Prereqs (tenant model)

The case was written against the legacy manual seed (`student-classroom@dev.local`,
password `pass`, organization „Classroom”). The suite version uses the case's own
tenant and never the legacy account.

- Profile: `org-limit` (`__tests__/qa/profiles/STU-43.json`) — an organization
  `qa-stu-43-<suffix>` with a manager, two educators, the org `student` this case signs
  in as, and two `invitee` student accounts that are **not** org members. All ids come
  from `tenantKey('qa/cases/STU-43.md', 'STU-43#<suffix>', 'qa-shared')` +
  `tenantId(key, entity)`.
- Seed: `bun scripts/qa-tenant.ts STU-43 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/users. The spec reads the ids through
  `loadTenant('STU-43')`.
- Why `org-limit`: the case has two acceptance criteria in one tenant — a student
  „po kilku quizach” and „konto bez quizów”. The `content` profile gives only one
  student, and CI reuses a seeded tenant for retries/`--repeat-each`, so the
  quiz-taking student already has history on a later pass. The profile's `invitee1`
  (a student who is not an org member) is the case's account without quizzes, so both
  halves stay deterministic on every run.
- The prerequisite — the quiz history — is built by the spec through the product API
  as the tenant student: one personal bank with two multiple-choice questions
  (found-or-created, so a retry reuses them instead of spending the plan's bank
  quota), then two practice quizzes generated from that bank and submitted: one with
  both answers correct (2/2 → 100 %) and one with a single correct answer (1/2 → 50 %).
- The daily practice-quiz quota (`max_quiz_attempts_per_day`, 10 on the seeded plan)
  is per user per day, so every independent run must use a fresh tenant; the spec
  needs two attempts per run.
- Nothing global is read or written — no admin setting, feature flag, plan, platform
  stat or singleton row — and no other tenant is touched.

## Observed during the suite walk (shared app 3010 / DB 54421, worker qa-env-4, pl)

- `/app/stats/results` renders the heading **„Wyniki”** and three summary cards:
  **„Ukończone testy”**, **„Średni wynik”**, **„Najlepszy wynik”**; below them the card
  **„Historia testów”** with the table columns **Podejście / Wynik / Data**.
- Every completed attempt is one row, newest completion first, labelled positionally:
  **„Podejście #1”**, „Podejście #2”, … (the label is the row position, not a stored
  attempt number). The Wynik cell is a badge with the rounded percentage on the
  attempt's closed-question denominator (`score / gradable_questions`), e.g. `100%`
  for 2/2 and `50%` for 1/2; Data is the completion date in the `pl` locale
  (`29.10.2026`).
- With two attempts of 2/2 and 1/2 the cards read „Ukończone testy” **2**,
  „Średni wynik” **75%**, „Najlepszy wynik” **100%** — consistent with
  `GET /api/v1/stats/student` (`totalQuizzes`, `avgScore`, `bestScore`).
- **Konto bez quizów**: a student account with no attempts renders the empty state
  **„Brak historii quizów”** + „Rozwiąż quiz, aby zobaczyć swoją historię” and no
  history table. The case's copy „Brak podejść do testów” is outdated — it is the same
  empty-state wording the quiz page („Ostatnie quizy”) uses; a language note (P3), not
  a functional difference.
- The **„Zobacz pełną historię →”** link on `/app/study/quiz` opens
  `/app/stats/results` (the natural entry point for this page).
- API: `POST /api/v1/questions/banks` → 201, `POST /api/v1/questions` → 201,
  `POST /api/v1/quiz/new` (with `bankId`, `questionTypes: ['mcq']`, `questionCount: 2`)
  → 201 with the attempt and its two questions (no answer key before submission),
  `POST /api/v1/quiz/<attemptId>` → 200 `{ score, totalQuestions }`,
  `GET /api/v1/quiz/attempts` → the attempts with `gradable_questions: 2` and
  `completed_at`; creating more practice quizzes than
  `max_quiz_attempts_per_day` on one day (10 on the seeded plan) returns
  `429 USAGE_LIMIT_EXCEEDED`.
