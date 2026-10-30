# EDU-REP-01 — Lista zgłoszeń nauczyciela

- id: EDU-REP-01
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Zgłoszenia (nauczyciel)
- prereqs: STU-39
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Student zgłosił błąd w pytaniu/fiszce T1 (STU-39).

## Prerequisite context

### STU-39 — Zgłoszenie błędnej fiszki

_Warunek wstępny: S1, talia O1G1T1 (autor T1)._

1. W menu fiszki wybierz „Zgłoś nieprawidłowość”.
2. Wpisz „Odpowiedź jest błędna” i kliknij „Wyślij”.
3. Otwórz /app/reports.

Expected:

- Okno „Zgłoś nieprawidłowość pytania”, po wysłaniu toast „Zgłoszenie wysłane”.
- Zgłoszenie widoczne na liście /app/reports z treścią i statusem przeczytania.

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`teacher1@dev.local`,
`student1@dev.local`, deck `O1G1T1`, password `pass`). The suite version uses the case's
own tenant and never the legacy accounts.

- Profile: `content` (`__tests__/qa/profiles/EDU-REP-01.json`) — one organization, the default
  group `G1`, and one account per account type: `manager` (org `admin`, group `teacher`),
  `teacher` (account type `educator`, org `member` — the case's T1) and `student`
  (org `member`, member of `G1` — the case's S1).
- Seed: `bun scripts/qa-tenant.ts EDU-REP-01 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/group/users from
  `tenantKey('qa/cases/EDU-REP-01.md', 'EDU-REP-01#<suffix>', 'qa-shared')` +
  `tenantId(key, entity)`. The spec reads the ids through `loadTenant('EDU-REP-01')`.
  Password for every seeded account: `Seed4Test!`.
- Prerequisite, built by the spec through the product API (idempotent, so a CI retry on
  the same tenant reuses it):
  - the manager promotes the educator to group `teacher` of `G1` through the manager's own
    roster endpoint (`PUT /api/v1/organization/groups/:id/members`, the same write
    `/manage/groups` performs). The seeder enrols group members as `member`, and only a
    group teacher may share content to a group;
  - the educator creates the bank `EDU-REP-01 bank` shared to `G1` (the `O1G1T1`
    analogue) with one question, `EDU-REP-01: Ile wynosi 2+2?`;
  - the student files the report with the case's message „Odpowiedź jest błędna” through
    `POST /api/v1/questions/:id/reports` — the endpoint behind the „Zgłoś
    nieprawidłowość” dialog (STU-39).
- Isolation: the spec reads/writes no global admin setting, feature flag, plan, platform
  stat or singleton row, and does not touch another worker's tenant. The report is left
  unread, so the badge is asserted on the tenant's only report.

## Observed during the suite walk (shared app 3010 / DB 54421, worker qa-env-4, pl)

- `/edu/reports` renders the heading „Zgłoszenia” with the description „Zgłoszenia
  nieprawidłowości od studentów dotyczące Twoich pytań.” (the case's wording, verbatim).
- The list row shows the counterpart's name (`QA student`), the reported question's
  content, the status badge „Otwarte” and the last-activity date (`29.10.2026` in `pl`),
  plus the unread marker (red dot + „Nieprzeczytane” for screen readers).
- The sidebar entry „Zgłoszenia” carries the red unread badge `1`; it comes from
  `GET /api/v1/question-reports/unread-count`, and opening the thread (not this list)
  is what marks the report read.
- The student's `/app/reports` (STU-39) shows the same thread from the other side: the
  educator's name, the question content and the „Otwarte” badge.
- The „Zgłoś nieprawidłowość pytania” dialog (opened from the question row's flag button
  in the bank detail) answered the toast „Zgłoszenie wysłane”, confirming the endpoint
  the spec calls.

## Steps

1. Zaloguj się jako teacher1 i otwórz /edu/reports.

## Expected result

- Opis „Zgłoszenia nieprawidłowości od studentów dotyczące Twoich pytań.” i lista zgłoszeń z treścią, autorem, datą.
- Plakietka nieprzeczytanych przy „Zgłoszenia” w menu.
