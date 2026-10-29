# EDU-Q-02 — Pytanie wielokrotnego wyboru

- id: EDU-Q-02
- priority: P1 krytyczny
- module: EDU – Panel nauczyciela (/edu)
- section: Banki pytań i pytania (/edu/questions)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Bank „Fizyka”.

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`teacher1@dev.local`, password
`pass`, organization WSB Merito, bank „Fizyka”). The suite version uses the case's
own tenant and never the legacy accounts.

- `qa/tests/profiles/EDU-Q-02.json` declares the `content` profile: an organization
  (`qa-edu-q-02-<suffix>`), a manager, an educator `teacher`, a `student` and the
  default group `G1`. Seed it with
  `bun scripts/qa-tenant.ts EDU-Q-02 --fresh` (a fresh run suffix per independent
  run; `tenantKey('qa/cases/EDU-Q-02.md', 'EDU-Q-02#<suffix>', 'qa-shared')` and
  `tenantId` for every org/user/group id).
- The spec signs in as the tenant's `teacher` (account type `educator`, org member):
  `question_bank.*` and `question.*` are `own`-scoped, so the account may create its
  own bank and questions. `loginAs` sets `active_org_id` to the tenant org, so the
  bank and the question are stored in that organization.
- The case's prerequisite „Bank Fizyka” and the topic the question needs are built
  through the product API inside this tenant, idempotently (a retry against the same
  tenant does not duplicate them). The question itself is created through the UI,
  exactly as the case walks it. The spec removes its own previous question (by
  content, inside this tenant) before the walk, so the bank's empty state and the
  single table row are deterministic on a re-run.
- Isolation: the spec reads/writes no global admin setting, feature flag, plan,
  platform stat or singleton row, and does not touch another tenant.

## Observed during the suite walk (shared app 3010 / DB 54421, worker qa-env-2, pl)

- The bank detail (`/edu/questions/<bankId>`) shows the bank name, the „Utwórz
  pytanie” button and the table columns Pytanie / Typ / Tematy / Odpowiedzi / Akcje;
  an empty bank reads „Brak pytań w tym banku. Utwórz swoje pierwsze pytanie!”.
- „Utwórz pytanie” opens the dialog „Utwórz pytanie” / „Dodaj nowe pytanie do tego
  banku”. Its fields: „Typ pytania” („Wielokrotny wybór” / „Prawda / Fałsz” /
  „Otwarta odpowiedź”, default „Wielokrotny wybór”), „Treść pytania”, „Odpowiedzi”
  (one row „Odpowiedź 1” plus „Dodaj odpowiedź”, a radio per row and the hint
  „Zaznacz przycisk radio dla poprawnej odpowiedzi”), „Wyjaśnienie (opcjonalnie)”
  and „Tematy” („Wybierz tematy...”).
- The topic picker lists only the tenant's own topics; a topic created before the
  org context is active is not offered (the page reads `GET /api/v1/topics` once),
  so the spec creates the bank and topic before it loads the bank detail.
- „Utwórz” answers the toast „Pytanie utworzone” (the case's „Zapisz” maps to this
  button). The new row shows the content, the type badge „Wielokrotnego wyboru”, the
  topic badge „Kinematyka” and the answer count `4`.
- `GET /api/v1/questions?bankId=<id>` returns `type: 'mcq'` with four answers,
  exactly one `is_correct` (the radio's answer, `order_index` 0), the explanation
  and the topic assignment; the question is stored in the tenant organization with
  the bank's `personal` visibility.
- The edit dialog („Edytuj pytanie”, pencil action) reopens the stored state: four
  answer rows, only the correct radio checked, the explanation text and the topic
  chip preserved. „Anuluj” closes it without deleting the question.

## Steps

1. Kliknij „Utwórz pytanie”, typ „Wielokrotny wybór”.
2. Wpisz treść, dodaj 4 odpowiedzi („Dodaj odpowiedź”), zaznacz poprawną radiem, dodaj wyjaśnienie i temat.
3. Zapisz.

## Expected result

- Pytanie pojawia się w tabeli z typem „Wielokrotnego wyboru”, liczbą odpowiedzi, tematem.
- Dokładnie jedna odpowiedź oznaczona jako poprawna.
