# STU-40 — Wątek zgłoszenia – odpowiedzi

- id: STU-40
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Zgłoszenia nieprawidłowości (student)
- prereqs: EDU-REP-02
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Istniejące zgłoszenie; nauczyciel odpowiedział (EDU-REP-02).

## Prerequisite context

### EDU-REP-02 — Odpowiedź na zgłoszenie

_Warunek wstępny: EDU-REP-01._

1. Otwórz wątek, napisz odpowiedź w „Napisz odpowiedź…” i wyślij.
2. Zaloguj się jako zgłaszający student i sprawdź wątek.

Expected:

- Odpowiedź widoczna w wątku u obu stron; student widzi plakietkę nieprzeczytanych (STU-41).
- Pusta odpowiedź nie jest wysyłana.

## Steps

1. Otwórz zgłoszenie z listy /app/reports.
2. Przeczytaj odpowiedź nauczyciela, napisz odpowiedź w polu „Napisz odpowiedź…” i wyślij.

## Expected result

- Wątek pokazuje wiadomości w kolejności czasowej z autorami.
- Nowa wiadomość pojawia się od razu.

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`student1@dev.local` in group
`O1G1`, `teacher1@dev.local`, password `pass`, bank/question `O1G1T1`). The suite version
uses the case's own tenant and never the legacy accounts.

- Profile: `content` (`__tests__/qa/profiles/STU-40.json`) — one organization, one default
  group `G1`, and one account per account type: `manager` (org `admin`), `teacher`
  (account type `educator`, the „T1” analogue that owns the reported question) and
  `student` (org `member` in `G1`, the „S1” analogue and the reporting student).
- Seed: `bun scripts/qa-tenant.ts STU-40 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/group/users from
  `tenantKey('qa/cases/STU-40.md', 'STU-40#<suffix>', 'qa-shared')` + `tenantId(key, entity)`.
  The spec reads the ids through `loadTenant('STU-40')`.
- The active organization is required: `/api/v1/question-reports*` is scoped by
  `withAuth` to the tenant org from `loginAs`.
- The prerequisite „EDU-REP-02 — nauczyciel odpowiedział na zgłoszenie” is rebuilt inside
  this tenant through the product API, because the seeder ships no content:
  1. the tenant teacher owns one personal question bank (`STU-40 bank`) with one open
     question in the tenant organization (the case's `O1G1T1` analogue, created once and
     reused by name so a retry never duplicates it);
  2. the tenant student reports that question with „Odpowiedź jest błędna” through
     `POST /api/v1/questions/:id/reports` (STU-39), which addresses the report to the
     question's author;
  3. the tenant teacher answers it once with a case-scoped reply through
     `POST /api/v1/question-reports/:id/messages` (the same write the educator composer
     performs) — only when the thread has no teacher answer yet, so the chronological
     assertions stay exact on a re-run against the same tenant (`--retries=2` in CI).
- Isolation: the spec reads/writes no global admin setting, feature flag, plan, platform
  stat or singleton row, and does not touch another tenant.
