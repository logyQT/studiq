# STU-39 — Zgłoszenie błędnej fiszki

- id: STU-39
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Zgłoszenia nieprawidłowości (student)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

S1, talia O1G1T1 (autor T1).

## Steps

1. W menu fiszki wybierz „Zgłoś nieprawidłowość”.
2. Wpisz „Odpowiedź jest błędna” i kliknij „Wyślij”.
3. Otwórz /app/reports.

## Expected result

- Okno „Zgłoś nieprawidłowość pytania”, po wysłaniu toast „Zgłoszenie wysłane”.
- Zgłoszenie widoczne na liście /app/reports z treścią i statusem przeczytania.

## Prereqs (tenant model)

The case was written against the legacy manual seed (`student1@dev.local`,
`teacher1@dev.local`, deck `O1G1T1`, password `pass`). The suite version uses the case's
own tenant and never the legacy accounts.

- Profile: `content` (`qa/tests/profiles/STU-39.json`) — one organization, the default
  group `G1`, and one account per account type: `manager` (org `admin`, group `teacher`),
  `teacher` (account type `educator`, org + group `member` — the case's T1) and `student`
  (org `member`, member of `G1` — the case's S1).
- Seed: `bun scripts/qa-tenant.ts STU-39 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/group/users from
  `tenantKey('qa/cases/STU-39.md', 'STU-39#<suffix>', 'qa-shared')` +
  `tenantId(key, entity)`. The spec reads the ids through `loadTenant('STU-39')`.
  Default password: `Seed4Test!`.
- Prerequisite, built by the spec through the product API (idempotent, so a CI retry on
  the same tenant reuses it):
  - the manager promotes the educator to group `teacher` of `G1` through
    `PUT /api/v1/organization/groups/:id/members` (the seeder enrols group members as
    `member`, and only a group teacher may share content to a group);
  - the educator creates the bank `STU-39 bank` shared to `G1` with the question
    `STU-39: Ile wynosi 2+2?` (the `O1G1T1` analogue, authored by T1);
  - the educator creates the deck `STU-39 talia` shared to `G1` and one flashcard in it
    linked to that question (`POST /api/v1/flashcards` with `questionId` — the
    „Utwórz fiszkę z pytania” flow). Only a flashcard linked to a question offers
    „Zgłoś nieprawidłowość”, because the report goes to the question's author.
- The report itself („Odpowiedź jest błędna”) is filed through the **UI**, in the case's
  dialog, by the tenant student; the teacher's reply used for the read-status regression
  is posted from a second browser context against the same tenant.
- Isolation: the spec reads/writes no global admin setting, feature flag, plan, platform
  stat or singleton row, and does not touch another worker's tenant. All ids derive from
  the tenant fixture; the report list is scoped to the report the case creates.

## Observed during the suite walk (shared app 3010 / DB 54421, worker qa-env-8, pl)

- The deck view (`/app/flashcards/<id>`) lists the card with its question text and
  answer. The hidden-until-hover „Więcej akcji fiszki” button (desktop variant) opens
  the flashcard menu: „Wybierz Fiszki”, „Kopiuj do Innej Talii”, „Zgłoś nieprawidłowość”
  (flag icon). The report item is rendered only when the card has a `question_id`; a
  card created without a question shows no report entry.
- „Zgłoś nieprawidłowość” opens the dialog „Zgłoś nieprawidłowość pytania” with the
  description „Opisz, na czym polega problem. Wiadomość trafi bezpośrednio do
  wykładowcy, który stworzył to pytanie.”, a label „Treść zgłoszenia”, a placeholder
  „Np. odpowiedź jest błędna, treść pytania jest niejasna...”, and the buttons
  „Anuluj” / „Wyślij” („Wyślij” is disabled while the textarea is empty).
- „Wyślij” posts `POST /api/v1/questions/<questionId>/reports` (`{ message }` → 201),
  closes the dialog and raises the toast „Zgłoszenie wysłane”.
- `/app/reports` renders the breadcrumb „Zgłoszenia”, the heading „Zgłoszenia”, the
  description „Twoje zgłoszenia nieprawidłowości pytań i odpowiedzi wykładowców.” and one
  card per report: the counterpart's name (the teacher — „QA teacher”), the reported
  question's content (`STU-39: Ile wynosi 2+2?`), the status badge „Otwarte” and the
  last-activity date (`29.10.2026` in `pl`). For the reporter the row is **read** right
  after sending (the message trigger writes `reporter_last_read_at`), so it carries no
  red unread dot and no „Nieprzeczytane” screen-reader text, and the sidebar
  „Zgłoszenia” entry has no badge (`GET /question-reports/unread-count` → `0`).
- That read state is the visible „status przeczytania”: after the teacher replies in the
  thread, the student's list row shows the red dot + „Nieprzeczytane” and the sidebar
  badge `1`; opening the row (`/app/reports/<id>`, which shows the report's message
  „Odpowiedź jest błędna” and the reply) marks it read again and the marker disappears.
- The report list shows the **question** content, not the report message; the message
  body is shown in the thread (`/app/reports/<id>`) — both are asserted for the report
  the case creates.

## Steps (reconciled)

1. As the tenant student, open the teacher's group deck `STU-39 talia` and choose
   „Zgłoś nieprawidłowość” in the flashcard menu.
2. Type „Odpowiedź jest błędna” and click „Wyślij”.
3. Open `/app/reports` (and the report's thread).
