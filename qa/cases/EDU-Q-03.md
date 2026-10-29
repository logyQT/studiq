# EDU-Q-03 — Pytanie Prawda/Fałsz

- id: EDU-Q-03
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Banki pytań i pytania (/edu/questions)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Bank „Fizyka”.

## Steps

1. Utwórz pytanie typu „Prawda / Fałsz”, użyj „Generuj opcje Prawda/Fałsz”.
2. Zaznacz poprawną odpowiedź i zapisz.

## Expected result

- Powstają dwie opcje „Prawda” i „Fałsz”; zapisane pytanie ma typ P/F.

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`teacher1@dev.local`, password `pass`,
bank „Fizyka” in the WSB Merito dataset). The suite version uses the case's own tenant and
never the legacy accounts.

- Profile: `content` (`qa/tests/profiles/EDU-Q-03.json`) — one organization, one default
  group `G1`, and one account per account type: `manager` (org `admin`), `teacher`
  (account type `educator`, org `member`), `student`.
- Seed: `bun scripts/qa-tenant.ts EDU-Q-03 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/group/users from
  `tenantKey('qa/cases/EDU-Q-03.md', 'EDU-Q-03#<suffix>', 'qa-shared')` +
  `tenantId(key, entity)`. The spec reads the ids through `loadTenant('EDU-Q-03')`.
- The bank „Fizyka” is the case's prerequisite and belongs to the tenant's `teacher`; the
  spec reuses it when a run already created it, otherwise creates it through the product
  API (`POST /api/v1/questions/banks`) — the same request the „Nowy bank” dialog sends.
  The teacher's org role is `member`, whose `question_bank.*` / `question.*` scope is `own`,
  which is enough for a personal bank and its questions. No global data (admin settings,
  feature flags, plans, platform stats, singleton rows) is read or written, and no other
  worker's tenant is touched.
- Idempotency: a question left in the bank by an earlier run with the same content is
  deleted through the API before the walk, so a retry against the same tenant starts from
  an empty bank (CI seeds once and retries against that seed).

## Product note — the „Generuj opcje Prawda/Fałsz” button

The step's „Generuj opcje Prawda/Fałsz” control no longer exists. Since the true/false
normalisation landed, switching the type to „Prawda / Fałsz” seeds both options
immediately („Prawda”, „Fałsz”, with „Prawda” preselected as correct) — there is no extra
generate click. The unused `QuestionForm.generate_tf` copy („Generuj opcje Prawda/Fałsz”)
is a leftover of the retired button, not a missing action. The expected result is
unchanged and is what the spec asserts: two options „Prawda” and „Fałsz” appear and the
saved question is stored as type P/F (`true_false`). Verified during the walk on the
shared app (worker qa-env-6); no defect filed, because the outcome the case requires is
present.
