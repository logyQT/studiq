# LIM-03 — Wyższy limit po zakupie planu

- id: LIM-03
- priority: P2 ważny
- module: LIM – Funkcje (feature flags) i limity planów
- section: Egzekwowanie limitów
- prereqs: LIM-02
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Po LIM-02 (limity Base obniżone do 2). Konto TS.

## Seed (reconciled with the tenant seeder)

The verbatim prerequisite is **LIM-02**, which lowers the **global** `base` plan
(`update plan_limits set limit_value = 2 …`) and then resets the database. That
is a mutation of the shared plan catalogue — every case and every worker would
see the lowered limits — so a QA-suite spec must not do it, and the tenant
seeder cannot express a per-tenant limit override.

The tenant reproduces the same "already at the cap" starting point at the
**real** Base limit (10 decks, the value LIM-01 documents and `/app/billing`
shows) instead of the artificially lowered 2:

```bash
bun scripts/qa-tenant.ts LIM-03 --fresh   # profile: __tests__/qa/profiles/LIM-03.json
```

- **Profile**: `bare` / `student` — one student, no organization, no group and
  the default free `base` personal plan written by `handle_new_user`. This is
  the case's TS account: outside an org the personal plan (not an org plan)
  governs the deck limit (#233), so the Spark purchase visibly raises it.
- **Tenant key**: `tenantKey('qa/cases/LIM-03.md', 'LIM-03#<run>', 'qa-shared')`
  and `tenantId(key, entity)`; user `users.student`, password `Seed4Test!`.
  `--fresh` gives every independent run its own student.
- **Setup inside the test**: the spec fills the Base quota (10 decks) through
  `POST /api/v1/flashcards/decks`, so the next deck is refused with
  `USAGE_LIMIT_EXCEEDED` / HTTP 429. The purchase writes only this tenant's own
  `profiles.personal_plan_key` plus a `payments` row; the plan catalogue is
  read through the public API and never changed.
- **Re-runnability**: a purchase is one-way and the student cannot be
  downgraded through the product, while CI retries against the same tenant.
  The spec therefore normalizes **its own tenant only** at the start: it resets
  `profiles.personal_plan_key` of `users.student` to `base` and deletes that
  student's own decks through the API. No other row, tenant or global setting is
  touched, and a re-run repeats the exact flow a fresh tenant would.

### LIM-02 context (not executed by this case)

LIM-02 (`qa/cases/LIM-02.md`) lowers the Base limits to 2 in Supabase Studio so
the manual tester reaches the cap after two records:

1. `update plan_limits set limit_value = 2 where plan_key = 'base' and limit_key in ('max_decks', 'max_flashcards', 'max_questions', 'max_question_banks');`
2. Two decks, then a third one; two flashcards, then a third; two question
   banks, then a third; two questions in one bank, then a third.
3. `bunx supabase db reset` restores the limits afterwards.

The manual expectations stay as written: the third deck/flashcard/question is
refused with `USAGE_LIMIT_EXCEEDED` / HTTP 429 and a readable UI message rather
than a blank screen; the question-bank limit is reportedly displayed but not
enforced (an observation for LIM-02, not this case).

## Steps

1. Kup plan Spark (BIL-03).
2. Spróbuj utworzyć 3. talię.

## Expected result

- Po zakupie obowiązuje limit planu Spark (talie: 50) – 3. talia powstaje bez błędu. Strona rozliczeń pokazuje nowe limity.

## Walk observations (shared app, pl)

- Start: `/app/billing` shows „Aktualny plan: StudiQ Base”, badge „Darmowy”,
  „Maks. talie 10”, „Maks. fiszki 100”. With 10 decks the flashcards list says
  „10 talii”.
- Creating the 11th deck (the case's "3rd" under the lowered LIM-02 limits) is
  refused: `POST /api/v1/flashcards/decks` answers **429**
  `{"error":"USAGE_LIMIT_EXCEEDED"}`, the dialog stays open and an error toast
  „Nie udało się zapisać talii” appears — a readable message, not a blank screen.
  The copy is generic (LIM-02's "czytelny komunikat o limicie" concern); LIM-03
  only asserts that the attempt fails cleanly and creates no deck.
- Purchase path: `/pricing/student` → Spark card → „Przejdź na Spark” →
  `/checkout?session_id=…&plan_id=spark` (summary names Spark, „9,99 zł/miesiąc”,
  „Maks. talie 50”, „Razem”) → card `4242 4242 4242 4242`, `12/30`, `123`,
  „Test Student” → „Zapłać 9,99 zł/miesiąc” → „Płatność udana!
  Przekierowywanie…” → `/billing/success` „Zakup udany!” → `/app`.
- `GET /api/v1/me/personal-plan` then reports `spark` with `max_decks: 50`
  (`max_flashcards: 500`, `max_questions: 200`), `/app/billing` shows
  „StudiQ Spark”, badge „Aktywny”, „Maks. talie 50”, and creating the 11th deck
  succeeds („Talia utworzona”, dialog closes, the deck appears in the list).
  The behavior matches the case exactly; no defect to report.
