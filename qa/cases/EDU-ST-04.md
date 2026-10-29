# EDU-ST-04 — Statystyki – testy (/edu/stats/quizzes)

- id: EDU-ST-04
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Statystyki nauczyciela
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Po próbach quizów.

## Prereqs (tenant model)

The case's own tenant, seeded by `bun scripts/qa-tenant.ts EDU-ST-04 --fresh` (never
the legacy `teacher-classroom@dev.local` / `student-classroom@dev.local` / `pass`
accounts):

- key: `tenantKey('qa/cases/EDU-ST-04.md', 'EDU-ST-04#<run suffix>', 'qa-shared')`
- `qa/tests/profiles/EDU-ST-04.json` declares the default `content` profile: one
  organization (`qa-edu-st-04-<suffix>`) with the default group `G1`, its manager,
  an `educator` teacher and a `student`.
- `GET /api/v1/stats/teacher/quizzes` aggregates the attempts of the org members
  whose **org role is `member`** — i.e. the tenant's `student`. The manager (admin)
  and the teacher (teacher role) are not part of that population, so the page only
  ever shows this tenant's student's attempts.
- the tenant's `teacher` is an org member, so `assignment.*` / `quiz.*` resolve to
  the `own` scope: it may create a bank, questions, a saved quiz and an assignment
  from that quiz, target `G1` and publish it. Nothing global is written (no admin
  setting, feature flag, plan, platform stat or singleton row) and no other worker's
  tenant is read.
- the spec builds the prerequisite through the product API inside this tenant: two
  true/false questions, a quiz „EDU-ST-04 Test”, an assignment created from that
  quiz with `maxAttempts: 3`, then the student's two attempts — one completed at
  1/2 and one started but abandoned.
- Retry-safety: CI seeds the case tenant **once** and reuses it for every retry. The
  page is a tenant-wide aggregate, so the spec first deletes only its own student's
  `quiz_attempts` rows (service-role client, same helper other cases use for their
  own rows) before asserting the empty state or building the two attempts.

Every org/user/group id is `tenantId(key, entity)`; each independent run folds a
fresh suffix into the key, so a re-run never sees a previous run's attempts.

## Steps

1. Otwórz /edu/stats/quizzes.

## Expected result

- Tabela: Test, Podejścia, Śr. wynik, Ukończenie; brak danych: „Brak danych testów”.

## Walk observations (shared app, pl)

- The page is reachable by direct URL only: the „Statystyki” section of the teacher
  sidebar lists „Treści” (`/edu/stats/data`), „Wyniki” (`/edu/stats/results`) and
  „Aktywność” (`/edu/stats/activity`) — there is no menu entry for
  `/edu/stats/quizzes`. The case's step is „Otwórz /edu/stats/quizzes”, so the spec
  navigates to the URL directly. This is a navigation gap, not a failure of the
  screen the case describes.
- The screen is headed „Statystyki testów” with the subtitle „Wyniki studentów we
  wszystkich testach” and one card „Wydajność testów” / „Średnie wyniki i wskaźniki
  ukończenia według testu”.
- With no attempts the card body is the case's empty state „Brak danych testów” and
  no table is rendered at all (the card is not an empty table shell).
- After the student's attempts the card renders one table with exactly the case's
  four columns, in order: Test, Podejścia, Śr. wynik, Ukończenie. The „Test” cell is
  the name of the quiz behind the assignment („EDU-ST-04 Test”), not the assignment
  title; „Śr. wynik” is a badge (secondary variant for 40–70%), „Ukończenie” plain
  text.
- The aggregates are tenant-wide and live: „Podejścia” counts **started** attempts,
  „Śr. wynik” averages the **completed** attempts' normalised score, and
  „Ukończenie” is completed ÷ started. With one completed attempt at 1/2 plus one
  started-but-abandoned attempt the row is `2 / 50% / 50%`.
- The page fetches once on mount (`useEffect` + `fetch`), so a teacher who opened it
  before the student's attempts sees the empty state until the page is reloaded. The
  spec loads the page after the attempts are in place (a tester would refresh).
- The behavior matches the case exactly; no defect to report.

## Test

`qa/tests/EDU/EDU-ST-04.spec.ts` — one spec, one worker:
`bunx playwright test -c qa/playwright.qa.config.ts qa/tests/EDU/EDU-ST-04.spec.ts --workers=1 --repeat-each=1`
