# STU-30 — Tworzenie, edycja, usunięcie tematu

- id: STU-30
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Tematy (/app/topics)
- prereqs: tenant `content` (student z rolą organizacyjną `member`; `topic.read/create/update/delete` dla własnych tematów)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Konto S1.

## Seed (tenant model)

Automatyzacja nie używa ręcznego seeda (`student1@dev.local`, `pass`, organizacje WSB
Merito / UE Wrocław, grupa `O1G1`). Przypadek dostaje własny tenant, zasiewany przez runner
suite przed każdym niezależnym przebiegiem:

```bash
bun scripts/qa-tenant.ts STU-30 --fresh
bunx playwright test -c qa/playwright.qa.config.ts \
  __tests__/qa/STU/STU-30.spec.ts --workers=1
```

- `__tests__/qa/profiles/STU-30.json` deklaruje domyślny profil `content`: jedna organizacja
  z managerem (admin organizacji, nieużywany w teście), edukatorem i studentem, na którym
  test się loguje, oraz domyślna grupa `G1`. Klucz tenanta:
  `tenantKey('qa/cases/STU-30.md', 'STU-30#<run>', 'qa-shared')`, wszystkie id z
  `tenantId`; każdy niezależny przebieg dokłada świeży sufiks.
- S1 to student organizacji (`member`), a nie konto samodzielne: rola `member` ma
  `topic.read/create/update/delete`, więc tworzenie i edycja własnych tematów jest tą
  samą ścieżką co w ręcznym seedzie.
- Profil zasiewa wyłącznie graf, więc całą treść przypadku buduje sam spec w tym samym
  tenancie: student tworzy „Matematyka”, zmienia nazwę na „Matematyka 2” i usuwa temat
  przez interfejs `/app/topics`.
- CI zasiewa tenant **raz** i używa go ponownie w każdym retry; dlatego test na starcie
  usuwa przez API własne tematy o nazwach `Matematyka` / `Matematyka 2` (tylko wiersze
  utworzone przez tego studenta), żeby kolejny przebieg zaczynał od tej samej pustej
  listy.
- Izolacja: test tworzy i sprząta wyłącznie tematy własnego tenanta; nie dotyka innego
  tenanta, ustawień admina, flag funkcji, planów, statystyk platformy ani wierszy
  singletonowych.

## Steps

1. Kliknij „Nowy Temat”, nazwa „Matematyka”, zapisz.
2. Edytuj nazwę na „Matematyka 2”.
3. Usuń temat (potwierdź).
4. Spróbuj utworzyć temat o pustej nazwie.

## Expected result

- Toasty „Temat utworzony”, „Temat zaktualizowany”, „Temat usunięty”.
- Dialog usuwania: „Usunąć Temat?” – „To trwale usunie temat. Tej akcji nie można cofnąć.”
- Pusta nazwa → „Nazwa tematu jest wymagana”.

## Observed on the shared app (walk, qa-env-5)

- `/app/topics` renders the „Moja Nauka › Menedżer Tematów” breadcrumb, the „Nowy Temat”
  toolbar button, the search field („Szukaj tematów...”), the scope select („Wszystkie”),
  the group multi-select („Dowolna grupa”), the sort select („Od najnowszych”) and, on an
  empty tenant, the empty state „Nic tutaj jeszcze nie ma, stwórz swój pierwszy temat!”
  with a second „Nowy Temat” action.
- „Nowy Temat” opens „Utwórz Temat” / „Dodaj nowy temat fiszek” with one empty name field
  and the buttons „Anuluj” / „Utwórz”. A student's dialog has no visibility radio — the
  group picker only renders when the API returns manageable groups (managers), which the
  case does not require.
- Saving „Matematyka” shows „Temat utworzony”, closes the dialog and adds a card with the
  „0 fiszek” badge, owned by the signed-in student.
- The card menu is „Więcej akcji: <nazwa>” with „Wybierz” / „Edytuj” / „Usuń”. „Edytuj”
  opens „Edytuj Temat” / „Zaktualizuj nazwę tematu” prefilled with the current name;
  saving shows „Temat zaktualizowany”, closes the dialog and the card takes the new name
  (same topic id, still 0 flashcards).
- „Usuń” asks „Usunąć Temat?” / „To trwale usunie temat. Tej akcji nie można cofnąć.” —
  exactly as the case specifies (capital „T”). Confirming shows „Temat usunięty”, closes
  the dialog, removes the card and the topic disappears from the API.
- Submitting an empty name shows „Nazwa tematu jest wymagana”, keeps the dialog open and
  creates nothing; cancelling afterwards leaves the list empty.
