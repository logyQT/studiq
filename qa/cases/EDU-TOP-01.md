# EDU-TOP-01 — Tematy nauczyciela – CRUD i widoczność

- id: EDU-TOP-01
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Tematy (/edu/topics)
- prereqs: tenant `content` (educator whose org role is `member` → `topic.read` = `group`, one group `G1`)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany teacher1.

## Steps

1. Otwórz /edu/topics.
2. Utwórz temat „Algebra”.
3. Zmień nazwę, a następnie usuń.
4. Sprawdź filtr zakresu Wszystkie / Moje i filtr grup („Dowolna grupa” / „Moje grupy”).

## Expected result

- Toasty utworzenia/aktualizacji/usunięcia; pusta nazwa → „Nazwa tematu jest wymagana”.
- Temat powiązany z fiszkami/pytaniami pokazuje poprawną liczbę fiszek.
- Filtry: Wszystkie / Moje + multi-select grup; brak opcji „Udostępnione”.

## Observed on the shared app (walk, qa-env-8)

- `/edu/topics` renders the breadcrumb „Panel Nauczyciela › Tematy fiszek”, the search
  field („Szukaj tematów…”), the scope select („Wszystkie”), the group multi-select
  („Dowolna grupa”), the „Moje grupy” quick action, the sort select („Od najnowszych”) and
  the „Nowy temat” button. The sidebar entry is „Tematy”.
- „Nowy temat” opens „Utwórz temat” / „Dodaj nowy temat fiszek” with one empty name field and
  the buttons „Anuluj” / „Utwórz”. Submitting the empty field shows the error toast
  „Nazwa tematu jest wymagana”, keeps the dialog open and sends no request.
- Creating „Algebra” shows „Temat utworzony”, closes the dialog and adds a card with the
  „0 fiszek” badge and the „Przeglądaj fiszki” action.
- The card menu is „Więcej akcji: <nazwa>” with „Wybierz Fiszki” / „Edytuj” / „Usuń”.
  „Edytuj” opens „Edytuj temat” / „Zaktualizuj nazwę tematu” prefilled with the current name;
  saving shows „Temat zaktualizowany” and the card takes the new name.
- „Usuń” asks „Usunąć temat?” / „To trwale usunie temat. Tej akcji nie można cofnąć.”;
  confirming shows „Temat usunięty” and removes the card.
- Two flashcards assigned to the topic show „2 fiszek” on the card and the preview dialog
  „Przeglądaj fiszki” lists both with „2 fiszki w tym temacie”. The number is correct; the
  card badge uses the non-plural message `flashcards_count` („2 fiszek” instead of
  „2 fiszki”), which is a copy nit (P3), not a wrong count — the spec asserts the number and
  tolerates the plural form.
- The scope select has exactly two options, „Wszystkie” and „Moje”; there is no
  „Udostępnione” and no „Grupy” option. „Moje” keeps only the educator's own topics.
- The group filter is a single multi-select: the trigger starts on „Dowolna grupa”, offers the
  tenant group `G1` (with a search box), and „Moje grupy” selects the educator's groups,
  leaves only the `G1`-linked topics and disables itself until the selection changes.

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`teacher1@dev.local`, password `pass`,
organizations WSB Merito / UE Wrocław, groups `O1G1` / `O2G1`, the „Algebra” topic). The suite
version uses the case's own tenant and never the legacy accounts.

- Profile: `content` (`qa/tests/profiles/EDU-TOP-01.json`) — one organization, one default
  group `G1`, and one account per account type: `manager` (org `admin`), `teacher` (account
  type `educator`, org `member`), `student`.
- Why that profile: an org-`member` educator has `topic.read` = `group`, so it sees its own
  topics **and** the topics shared to `G1`. That is the minimum shape the filter step needs:
  a row that „Wszystkie” shows and „Moje” hides. A teacher-role educator would get
  `topic.read` = `own`, which would make „Moje” and „Wszystkie” identical.
- Seed: `bun scripts/qa-tenant.ts EDU-TOP-01 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/group/users from
  `tenantKey('qa/cases/EDU-TOP-01.md', 'EDU-TOP-01#<suffix>', 'qa-shared')` +
  `tenantId(key, entity)`. The spec reads the ids through `loadTenant('EDU-TOP-01')`.
- Content (prepared by the spec through the product API, deleted and re-created on every
  execution so a CI retry on the same tenant starts from the same list):
  - the topic „EDU-TOP-01 wspólny” created by the tenant manager and shared to `G1` — the
    „content shared by another org member” analogue, visible under „Wszystkie” only;
  - the topic „EDU-TOP-01 własny” owned by the educator — the row „Moje” still shows after
    the case's own „Algebra” topic is deleted in step 3, since the filter check is step 4;
  - the deck „EDU-TOP-01 talia” with exactly two flashcards assigned to „Algebra” — the
    counter assertion.
- „Algebra” itself (create → rename → delete), its flashcards and both filters go through
  the UI, exactly as the case describes.
- Not asserted: „pytania” in the expected result. The screen's counter is
  `flashcard_topic_assignments` only, and the case's own step 3 links the topic to flashcards;
  question linking is covered by the question-bank cases.
