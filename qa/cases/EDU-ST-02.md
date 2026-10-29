# EDU-ST-02 — Statystyki – „Wyniki” (/edu/stats/results)

- id: EDU-ST-02
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Statystyki nauczyciela
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Po kilku próbach quizów/fiszek studenta SC.

## Prereqs / Seed (reconciled with the tenant seeder)

- Tenant: `bun scripts/qa-tenant.ts EDU-ST-02 --fresh`, declared in
  `qa/tests/profiles/EDU-ST-02.json` as `{ "profile": "org-limit", "plan": "campus" }`.
- Organization `qa-edu-st-02-<suffix>` with an admin, two educators (`teacher`,
  `teacher2`) and one student, plus the default group `G1`.
- The legacy manual accounts (`teacher-classroom@dev.local`,
  `student-classroom@dev.local`, password `pass`) are **not** used; the case's `SC`
  maps to the tenant's `student`.
- The „kilka prób quizów/fiszek” is built by the spec through the product API on
  every execution, with a per-execution tag:
  - `teacher` creates a deck of four cards, a bank of three multiple-choice
    questions and a quiz holding them, published as an assignment for the student
    (`maxAttempts: 2`, `showResults: true`);
  - `student` completes two attempts (two of three answers right, so one question
    stays at 0 %) and practises the four cards (three right, one wrong → 75 %
    accuracy, 3 „łatwe” + 1 „trudna” card);
  - `teacher2` is a second educator of the same organization who never creates
    content — that is the „no problematic questions” branch, stable on every run.
- `plan: campus` is applied to the tenant's **own** organization through the same
  `apply_org_plan` RPC the billing webhook uses. The page itself is not
  plan-gated; the unlimited org plan only keeps repeated executions
  (`--repeat-each`, CI retries on one seeded tenant) from exhausting the
  `max_decks` / `max_question_banks` quotas. No global plan, feature flag, admin
  setting, platform stat or singleton row is touched.
- Spec: `qa/tests/EDU/EDU-ST-02.spec.ts`.

## Steps

1. Otwórz /edu/stats/results.

## Expected result

- Karty: Próby testów, Średni wynik testu, Łącznie ćwiczeń, Ogólna skuteczność, Śr. EF; wykres rozkładu trudności; „Problematyczne pytania” (poniżej 50% poprawnych).
- Brak problematycznych pytań: „Nie wykryto problematycznych pytań. Świetna robota!”.
- Linki „Zobacz wszystkie testy”, „Zobacz szczegóły fiszek/pytań”.

## Observations from the walk (worker qa-env-7, Polish UI)

- The five cards render as „Próby testów”, „Średni wynik testu”, „Łącznie ćwiczeń”,
  „Ogólna skuteczność”, „Śr. EF” (titles are upper-cased by CSS). With the seeded
  activity they show `2`, `67%`, `4`, `75%`, `2.37`.
- The difficulty chart is „Rozkład trudności” with the buckets Łatwy / Średni /
  Trudny / Nowy and their counts; it is hidden when no card has been practised.
- „Wyniki quizów” lists one row per quiz with Podejścia and Średni wynik
  (`EDU-ST-02 quiz <tag>` → `2` → `67%`).
- „Problematyczne pytania” carries the description „Pytania z poprawnością poniżej
  50%” and lists the 0 % question with „0% poprawnych”; the two questions answered
  correctly in both attempts are not listed.
- Without any such question the card shows „Nie wykryto problematycznych pytań.
  Świetna robota!” (no description line, no rows).
- The three links sit at the bottom of the page and open `/edu/stats/quizzes`
  („Statystyki testów”), `/edu/flashcards/stats` („Statystyki fiszek”) and
  `/edu/statistics` („Pytania według typu”).
