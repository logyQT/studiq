# STU-32 — Własny bank i własne pytania

- id: STU-32
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Pytania i banki (/app/questions)
- prereqs: none (self-contained tenant — see Prereqs)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany student1.

## Steps

1. Kliknij „Nowy bank”, nazwa „Mój bank”, zapisz.
2. Wejdź w bank, kliknij „Utwórz pytanie”.
3. Utwórz kolejno pytania typu: Wielokrotny wybór (3 odpowiedzi, zaznacz poprawną), Prawda/Fałsz, Otwarta odpowiedź – z wyjaśnieniem.

## Expected result

- Toasty „Bank pytań utworzony”, „Pytanie utworzone”.
- Tabela pytań pokazuje treść, typ (WW / P/F / Otwarte), tematy, liczbę odpowiedzi.
- Dla P/F opcje „Prawda”/„Fałsz” generują się przyciskiem „Generuj opcje Prawda/Fałsz”.

## Prereqs (tenant model)

The case was written against the legacy manual seed (`student1@dev.local`, password
`pass`). The suite version uses the case's own tenant and never the legacy accounts.

- Profile: `content` (`__tests__/qa/profiles/STU-32.json`) — one organization, one default
  group `G1`, and one account per account type: `manager` (org `admin`), `teacher` and
  the `student` under test.
- Seed: `bun scripts/qa-tenant.ts STU-32 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/users from
  `tenantKey('qa/cases/STU-32.md', 'STU-32#<suffix>', 'qa-shared')` + `tenantId(key, entity)`.
  The spec reads the ids through `loadTenant('STU-32')`.
- `student1` → the tenant `student`, who owns the bank and the questions. The bank
  „Mój bank” is created through the UI in step 1 (a student's bank is personal, so the
  form has no visibility selector); the three questions are created through the UI in
  step 3 on `/app/questions/<bankId>`.
- CI seeds the tenant **once** and reuses it for retries and `--repeat-each` passes, so
  the spec first deletes the student's own banks through the product API (all of them
  belong to this case; deleting a bank cascades its questions and answers). Every run
  then starts from the empty `/app/questions` list.
- Nothing global is read or written — no admin setting, feature flag, plan, platform
  stat or singleton row — and no other tenant is touched.

## Observed during the suite walk (shared app 3010 / DB 54421, worker qa-env-4, pl)

- Step 1 — a student's `/app/questions` is empty at first („Nic tu jeszcze nie ma,
  utwórz swój pierwszy bank pytań!”) and offers „Nowy bank” twice (toolbar and empty
  state). The „Nowy bank” form has `Nazwa` and `Opis` only; after „Utwórz” the toast
  **„Bank pytań utworzony”** appears and the card shows „Mój bank”, „0 pytań” and
  „Zarządzaj” (the case's „zapisz” is the form's „Utwórz”).
- Step 2 — „Zarządzaj” opens `/app/questions/<bankId>`; the bank detail shows the
  bank name as the heading, the button **„Utwórz pytanie”** and the empty table, with
  headers Pytanie / Typ / Tematy / Odpowiedzi / Akcje.
- Step 3 — the create dialog offers „Wielokrotny wybór”, „Prawda / Fałsz” and
  „Otwarta odpowiedź”; saving raises **„Pytanie utworzone”**.
  - WW: the form starts with one answer row and „Dodaj odpowiedź”; the radio next to
    the first answer marks it correct. The stored question has 3 answers with exactly
    one `is_correct`.
  - P/F: switching the type immediately renders two **editable** option rows
    „Prawda” / „Fałsz”, with „Prawda” pre-selected as correct. The
    „Generuj opcje Prawda/Fałsz” button from the case text no longer exists — this is
    the intentional product decision from #154/#607 (auto-seeded options, no extra
    click), not a defect.
  - Open: the answer rows disappear; the „Wyjaśnienie (opcjonalnie)” textarea is kept
    on the question. The stored question has 0 answers.
- The type column renders the full labels **„Wielokrotnego wyboru”**,
  **„Prawda / Fałsz”** and **„Otwarte”** — the case's „WW / P/F / Otwarte”
  abbreviations are outdated copy (language note, not a functional difference).
- A question without topics shows „—” in the Tematy column; the Odpowiedzi column
  shows `3`, `2` and `0` for the three questions, and the bank card changes from
  „0 pytań” to „3 pytania”.
- API: `POST /api/v1/questions/banks` → 201 with `visibility: 'personal'` and the
  student as `created_by`; `POST /api/v1/questions` → 201;
  `GET /api/v1/questions?bankId=<id>` returns the three questions with their
  answers/explanation and `GET /api/v1/questions/banks` reports `question_count: 3`.
