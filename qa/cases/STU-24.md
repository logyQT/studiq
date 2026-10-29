# STU-24 — Tematy fiszki – dodawanie i usuwanie

- id: STU-24
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Fiszki w talii (/app/flashcards/<id>)
- prereqs: tenant `content` (student owning a personal deck with one flashcard and one pre-existing topic)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Talia z fiszką.

## Steps

1. W menu fiszki wybierz „Dodaj Temat”, wpisz „Nowy temat” i wybierz „Utwórz „Nowy temat””.
2. Dodaj istniejący temat z listy.
3. Wybierz „Zarządzaj Tematami”, usuń jeden temat; „Usuń Tematy”.
4. Użyj „Zobacz według Tematu”.

## Expected result

- Toast „Temat dodany” / „Temat usunięty”; temat widoczny jako plakietka na fiszce.
- Brak dopasowań → „Nie znaleziono pasujących tematów”.
- „Zobacz według Tematu” pokazuje liczbę fiszek z tym tematem lub „Brak fiszek z tym tematem”.

## Observed on the shared app (walk, qa-env-8)

- The deck page `/app/flashcards/<id>` renders the breadcrumb „Moja Nauka › Fiszki ›
  <talia>”, the card count, the search field, the topic filter („Wszystkie tematy”) and the
  flashcards. Each card has the „Więcej akcji fiszki” menu (shown on hover).
- The menu is „Wybierz Fiszki” / „Edytuj” / **„Tematy”** (submenu) / „Przenieś do Innej Talii” /
  „Kopiuj do Innej Talii” / „Usuń”. The „Tematy” submenu holds exactly „Dodaj Temat”,
  „Zarządzaj Tematami” and „Zobacz według Tematu”.
- „Dodaj Temat” opens the dialog „Dodaj Temat” / „Wpisz nazwę, aby utworzyć nowy temat, lub
  wybierz istniejący”, with the field „Nazwa tematu...”, the list of topics not yet on the
  card, and „Anuluj” / „Dodaj” („Dodaj” disabled while the field is empty).
- Typing „Nowy temat” shows the create row „Utwórz „Nowy temat”” **and**, because no existing
  topic matches, the case's „Nie znaleziono pasujących tematów” line under it. Choosing the
  create row stores the topic, assigns it to the card, closes the dialog, shows the
  „Temat dodany” toast and renders „Nowy temat” as a badge on the card.
- Choosing an existing topic from the same list assigns it and shows „Temat dodany”; a topic
  already on the card is filtered out of the list. Both topics then show as badges.
- „Zarządzaj Tematami” opens „Zarządzaj Tematami” / „Dodaj lub usuń tematy z tej fiszki” with
  the card's topics as removable chips („×” on each). The buttons are „Anuluj” / „Zapisz” —
  the dialog has no „Usuń Tematy” button; that label belongs to the separate multi-card bulk
  operation (select cards → „Tematy” → „Usuń Tematy”). Removing a chip and saving shows
  „Temat usunięty”, drops that badge and keeps the other. The topic itself is only
  unassigned from this flashcard, not deleted from the topic list.
- „Zobacz według Tematu” opens a dialog titled with the card's first assigned topic, with the
  count „1 fiszka z tym tematem”, the question/answer of each card carrying it and the
  „Zamknij” button. The case's empty branch („Brak fiszek z tym tematem”) cannot be reached
  from this menu entry: the entry only opens for a card that already carries the topic, so
  the count is never 0. The empty branch exists on the topics screen (`/app/topics`, a
  different case's surface), not here.
- The badges survive a reload, i.e. they come from the API (`flashcard_topic_assignments`),
  not from a client-side cache patch.

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`student1@dev.local`, password `pass`,
organization WSB Merito, personal deck `O1S1`). The suite version uses the case's own tenant
and never the legacy account.

- Profile: `content` (`qa/tests/profiles/STU-24.json`) — one organization, one default group
  `G1`, and one account per account type: `manager`, `teacher`, `student`. The spec signs in
  as `student`; the org context is what scopes the deck, the card and the topics it creates.
- Seed: `bun scripts/qa-tenant.ts STU-24 --fresh` — a fresh run suffix per independent run, so
  every run gets its own org/group/users from
  `tenantKey('qa/cases/STU-24.md', 'STU-24#<suffix>', 'qa-shared')` + `tenantId(key, entity)`.
  The spec reads the ids through `loadTenant('STU-24')`.
- Content (prepared by the spec through the product API, reset on every execution so a CI
  retry on the same tenant starts from the same state):
  - the deck „STU-24 talia <suffix>” (the `O1S1` analogue) with exactly one flashcard
    „STU-24 fiszka 1” — the case's prerequisite „Talia z fiszką”, with no topics attached;
  - the topic „STU-24 istniejący” — the „existing topic” step 2 picks from the list (the
    legacy seed's topic analogue). „Nowy temat” is deliberately absent at the start: step 1
    creates it through the dialog, and a leftover with that name would turn the create row
    into an exact match and hide „Utwórz „Nowy temat””.
- „Nowy temat”, the existing topic, both assignments, the removal and „Zobacz według Tematu”
  all go through the UI, exactly as the case describes; the API is read afterwards only to
  confirm the stored `flashcard_topic_assignments`.
