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
4. Sprawdź przycisk „Filtry”: wymiar „Moje” i wymiar „Grupy” (grupy w panelu obok listy).

## Expected result

- Toasty utworzenia/aktualizacji/usunięcia; pusta nazwa → „Nazwa tematu jest wymagana”.
- Temat powiązany z fiszkami/pytaniami pokazuje poprawną liczbę fiszek.
- Filtry: jeden przycisk „Filtry” z wierszami „Moje” i „Grupy”; brak selecta zakresu i brak opcji „Udostępnione”.

## Observed on the shared app (walk, qa-env-8)

- `/edu/topics` renders the breadcrumb „Panel Nauczyciela › Tematy fiszek”, the search
  field („Szukaj tematów…”), one filter button „Filtry” (its rows are the dimensions
  „Moje” and „Grupy”; the groups themselves open in a panel beside the list), the sort
  select („Od najnowszych”) and the „Nowy temat” button. The sidebar entry is „Tematy”.
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
- The „Filtry” button has exactly two dimension rows, „Moje” and „Grupy”; there is no
  „Udostępnione” and no separate scope select. „Moje” keeps only the educator's own topics.
- The „Grupy” row selects the educator's groups in one click (the trigger shows a „Grupy”
  chip) and leaves only the `G1`-linked topics; ticking `G1` in the panel beside the list
  narrows the list the same way and leaves the row unselected.

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`teacher1@dev.local`, password `pass`,
organizations WSB Merito / UE Wrocław, groups `O1G1` / `O2G1`, the „Algebra” topic). The suite
version uses the case's own tenant and never the legacy accounts.

- Profile: `content` (`__tests__/qa/profiles/EDU-TOP-01.json`) — one organization, one default
  group `G1`, and one account per account type: `manager` (org `admin`), `teacher` (account
  type `educator`, org `teacher`), `student`.
- Why that profile: the org Teacher role has `topic.read` = `group` (D29), so the educator
  sees its own topics **and** the topics shared to `G1`. That is the minimum shape the filter
  step needs: a row that „Wszystkie” shows and „Moje” hides.
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

## Observed 2026-11-20 (2b-3) — the roster is now declared

The `content` profile's default educator is a real Teacher since 2b-3 (the roster read in
D25 needs an org role that carries `group.manage`/`group.invite`), but this case's premise
is the opposite: an educator on the org **Member** role, whose `topic.read` is `group`, so
the manager's `G1`-shared topic is visible under „Wszystkie”. The spec now fails on the
default (the shared topic is not visible), so the case declares its own roster instead:
`__tests__/qa/profiles/EDU-TOP-01.json` keeps `"profile": "content"` and adds `members` —
manager `admin`, educator `member`, student `member`, the same keys, account types, names,
ids and e-mails as before, with the default group `G1` and its membership unchanged. The
spec's own preparation (the shared topic created by the manager, the educator's own topic
and the two-flashcard deck) is unchanged, as are the assertions.

## Observed 2026-11-22 (3d) — the Member workaround is retired

D29 moves the Teacher role's content `.read` keys to `group`, so `topic.read` = `group` for
the real system role and the premise the 2b-3 workaround protected holds again.
`__tests__/qa/profiles/EDU-TOP-01.json` names `orgRole: "teacher"` (the default the 2b-3
note said failed), and the spec and the bullets above cite the Teacher role instead of the
Member role. Assertions and steps are unchanged.
