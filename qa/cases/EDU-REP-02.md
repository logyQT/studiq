# EDU-REP-02 — Odpowiedź na zgłoszenie

- id: EDU-REP-02
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Zgłoszenia (nauczyciel)
- prereqs: EDU-REP-01
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

EDU-REP-01.

## Prerequisite context

### EDU-REP-01 — Lista zgłoszeń nauczyciela

_Warunek wstępny: Student zgłosił błąd w pytaniu/fiszce T1 (STU-39)._

1. Zaloguj się jako teacher1 i otwórz /edu/reports.

Expected:

- Opis „Zgłoszenia nieprawidłowości od studentów dotyczące Twoich pytań.” i lista zgłoszeń z treścią, autorem, datą.
- Plakietka nieprzeczytanych przy „Zgłoszenia” w menu.

## Steps

1. Otwórz wątek, napisz odpowiedź w „Napisz odpowiedź…” i wyślij.
2. Zaloguj się jako zgłaszający student i sprawdź wątek.

## Expected result

- Odpowiedź widoczna w wątku u obu stron; student widzi plakietkę nieprzeczytanych (STU-41).
- Pusta odpowiedź nie jest wysyłana.

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`teacher1@dev.local`,
`student1@dev.local`, password `pass`, bank/deck `O1G1T1`). The suite version uses the
case's own tenant and never the legacy accounts.

- Profile: `content` (`qa/tests/profiles/EDU-REP-02.json`) — one organization, one
  default group `G1`, and one account per account type: `manager` (org `admin`),
  `teacher` (account type `educator`), `student`. The case is the educator's report
  thread, so the walk signs in as `teacher` and then as the reporting `student`.
- Seed: `bun scripts/qa-tenant.ts EDU-REP-02 --fresh` — a fresh run suffix per
  independent run, so every run gets its own org/group/users from
  `tenantKey('qa/cases/EDU-REP-02.md', 'EDU-REP-02#<suffix>', 'qa-shared')` +
  `tenantId(key, entity)`. The spec reads the ids through `loadTenant('EDU-REP-02')`.
- Prerequisite EDU-REP-01 / STU-39 („student zgłosił błąd w pytaniu”): the spec
  rebuilds it inside the tenant through the product API. The educator owns one
  personal question bank (`EDU-REP-02 Bank pytań`) with one open question in the
  tenant organization; the tenant student reports that question with
  „Odpowiedź jest błędna”. The product addresses the report to the question's author
  (`teacher_id` = the tenant educator), so no recipient is hard-coded.
- Each attempt creates its own report row and clears the stale unread receipts of
  both participants first, so the badge assertions stay exact on a re-run against
  the same tenant (`--retries=2` in CI): educator 1 → student 1 → 0.
- Nothing global is read or written: no admin setting, feature flag, plan, platform
  stat or singleton row; no other worker's tenant is touched.
