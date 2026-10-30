# EDU-Q-05 — Edycja i usuwanie pytań

- id: EDU-Q-05
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Banki pytań i pytania (/edu/questions)
- prereqs: EDU-Q-02 (bank „Fizyka” + its multiple-choice question, created inside this case's own tenant)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Pytania z EDU-Q-02…05.

## Prerequisite context

### EDU-Q-02 — Pytanie wielokrotnego wyboru

_Warunek wstępny: Bank „Fizyka”._

1. Kliknij „Utwórz pytanie”, typ „Wielokrotny wybór”.
2. Wpisz treść, dodaj 4 odpowiedzi („Dodaj odpowiedź”), zaznacz poprawną radiem, dodaj wyjaśnienie i temat.
3. Zapisz.

Expected:

- Pytanie pojawia się w tabeli z typem „Wielokrotnego wyboru”, liczbą odpowiedzi, tematem.
- Dokładnie jedna odpowiedź oznaczona jako poprawna.

## Steps

1. Edytuj pytanie (zmień poprawną odpowiedź), zapisz.
2. Usuń pytanie, potwierdź „Usunąć pytanie?”.

## Expected result

- Toasty „Pytanie zaktualizowane” / „Pytanie usunięte”.
- Usunięcie pytania użytego w quizie/kartkówce: zanotuj zachowanie (pytanie znika z quizu lub operacja zablokowana).

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`teacher1@dev.local`, bank „Fizyka” from
EDU-Q-02, password `pass`). The suite version uses the case's own tenant and never the legacy
accounts.

```bash
bun scripts/qa-tenant.ts EDU-Q-05 --fresh   # profile from __tests__/qa/profiles/EDU-Q-05.json
```

- Profile: `content` (`__tests__/qa/profiles/EDU-Q-05.json`) — one organization, the default group
  `G1`, and one account per account type: `manager` (org `admin`), `teacher` (account type
  `educator`, org `member` — the „T1” analogue that owns the question) and `student`. An
  educator's default `question.create/update/delete` scope is `own`, which is exactly what the
  case needs: the teacher edits and deletes the question it created. No org role or paid
  entitlement is involved.
- Tenant key: `tenantKey('qa/cases/EDU-Q-05.md', 'EDU-Q-05#<suffix>', 'qa-shared')`, every
  org/user/group id from `tenantId(key, entity)`; organization `qa-edu-q-05-<suffix>`.
  `--fresh` gives each independent run its own organization, so ids stay deterministic inside
  a run and no run reuses another's data. The spec reads them through `loadTenant('EDU-Q-05')`.
- Prerequisite (EDU-Q-02) built by the spec inside that tenant: the bank „Fizyka” through
  `POST /api/v1/questions/banks`, the topic „Kinematyka” through `POST /api/v1/topics` (the
  question dialog has no create-topic action), then a 4-answer `mcq` question through
  `POST /api/v1/questions` — answers „metr na sekundę” (correct), „metr”, „kilogram”,
  „sekunda”, explanation and topic attached. All three are reused when a re-run on the same
  tenant already has them; questions left behind by an interrupted run are deleted by exact
  content before the new one is created, so retries never accumulate duplicates.
- Isolation: the spec reads/writes no global admin setting, feature flag, plan, platform stat
  or singleton row, and does not touch another tenant; only this tenant's bank, topic and
  question.

## Observed during the suite walk (shared app 3010 / DB 54421, worker qa-env-3, pl)

- `/edu/questions/<bankId>` shows the bank name as `h2` with the „Utwórz pytanie” button, the
  search field, the „Wszystkie” type filter and the table Pytanie / Typ / Tematy / Odpowiedzi
  / Akcje. The row of the case's question carries the badge „Wielokrotnego wyboru”, the topic
  badge „Kinematyka”, the answer count `4` and two icon actions: „Edytuj” and „Usuń”.
- „Edytuj” opens „Edytuj pytanie” („Zaktualizuj szczegóły pytania”) pre-filled with the
  content, all four answers, the stored explanation, the topic „Kinematyka”, and exactly the
  one stored answer checked in the radio group. The submit button reads „Aktualizuj”.
- Changing the content, the explanation and the correct answer and saving shows „Pytanie
  zaktualizowane”, closes the dialog, re-renders the row in place with the new content (the
  type, topic and answers count stay), and stores exactly one correct answer — the newly
  selected one.
- „Usuń” opens „Usunąć pytanie?” with „To trwale usunie to pytanie i wszystkie jego
  odpowiedzi. Tej akcji nie można cofnąć.” and the buttons „Anuluj” / „Usuń”. „Anuluj” keeps
  the row and the question (API still `200`); „Usuń” shows „Pytanie usunięte”, removes the
  row, renders the empty state „Brak pytań w tym banku. Utwórz swoje pierwsze pytanie!” and
  `GET /api/v1/questions/:id` answers `404`.
- Recorded (the case asks to note, not to judge): a question used by a quiz can be deleted —
  no block, `DELETE` answers `200` — and it disappears from the quiz (`quiz_questions` is
  `ON DELETE CASCADE`; the quiz detail then lists no questions). Because the case leaves the
  expected behaviour open, the spec asserts only the unambiguous edit/delete points above and
  the cascade stays a walk note.
- Spec: `__tests__/qa/EDU/EDU-Q-05.spec.ts`; run with
  `bunx playwright test -c qa/playwright.qa.config.ts __tests__/qa/EDU/EDU-Q-05.spec.ts --workers=1`.
