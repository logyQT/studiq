# STU-21 — Tworzenie fiszki – edytor Markdown

- id: STU-21
- priority: P1 krytyczny
- module: STU – Panel studenta (/app)
- section: Fiszki w talii (/app/flashcards/<id>)
- prereqs: none (self-contained tenant — see Prereqs)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Własna talia.

## Steps

1. Kliknij „Nowa Fiszka”.
2. W polu „Przód (Pytanie)” wpisz „Stolica Polski?”, w „Tył (Odpowiedź)” – „Warszawa”.
3. Użyj paska narzędzi: Pogrubienie, Kursywa, Nagłówek 1–6, lista punktowana/numerowana, Link, Tabela; sprawdź, czy podgląd po prawej stronie na bieżąco renderuje wpisywany Markdown (bez przełącznika „Edytuj/Podgląd”).
4. Zapisz („Utwórz”).

## Expected result

- Toast „Fiszka utworzona pomyślnie”; fiszka widoczna w talii.
- Podgląd renderuje Markdown (pogrubienie, listy, linki, tabela) zgodnie z formatowaniem.
- Edytor i podgląd widoczne jednocześnie; brak przełącznika trybu edycji/podglądu.
- Przycisk „Link” pyta o URL; po zatwierdzeniu wstawia składnię Markdown.

## Prereqs (tenant model)

The case was written against the legacy manual seed (`student1@dev.local`, password
`pass`, personal deck `O1S1`). The suite version uses the case's own tenant and never
the legacy accounts.

- Profile: `content` (`__tests__/qa/profiles/STU-21.json`) — one organization, one default
  group `G1`, and one account per account type: `manager` (org `admin`), `teacher` and
  the `student` under test.
- Seed: `bun scripts/qa-tenant.ts STU-21 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/users from
  `tenantKey('qa/cases/STU-21.md', 'STU-21#<suffix>', 'qa-shared')` +
  `tenantId(key, entity)`. The spec reads the ids through `loadTenant('STU-21')`.
- `student1` → the tenant `student`. Its prerequisite deck („Własna talia”, the `O1S1`
  analogue) is created by the spec through the product API:
  `POST /api/v1/flashcards/decks` „STU-21 edytor <suffix>”, personal, empty, owned by
  that student in its own organization. The case then drives the UI on
  `/app/flashcards/<deckId>`.
- Nothing global is read or written — no admin setting, feature flag, plan, platform
  stat or singleton row — and no other tenant is touched. Every run works on the deck
  it just created, so a CI retry that reuses the seeded tenant cannot collide with a
  previous attempt's cards.

## Observed during the suite walk (shared app 3010 / DB 54421, worker qa-env-4, pl)

- Step 1: the deck view's toolbar button „Nowa Fiszka” opens the dialog titled
  **„Utwórz Nową Fiszkę”** (not „Nowa Fiszka” as a dialog title).
- Step 2 — field labels: the dialog labels the two fields **„Pytanie”** and
  **„Odpowiedź”** (uppercased by CSS), with the placeholders „Wprowadź pytanie lub
  prompt...” / „Wprowadź odpowiedź lub wyjaśnienie...”. The case's „Przód (Pytanie)” /
  „Tył (Odpowiedź)” wording is the CSV-import dialog's, not this editor's; the
  validation toast still says „Zarówno przód jak i tył są wymagane”. Copy difference
  only (P3) — the mapping front→Pytanie, back→Odpowiedź is unambiguous.
- Step 2 — layout: editor on the left, preview column on the right (both sides).
  The preview follows the typing with a ~300 ms debounce; there is **no**
  „Edytuj/Podgląd” toggle and no tab strip. Editor and preview are visible at the
  same time.
- Step 3 — toolbar inserts into the **focused** field. With an empty selection:
  `**pogrubienie**`, `*kursywa*`, `# `…`###### ` for Nagłówek 1–6, `- ` for Lista
  punktowana, `1. ` for Lista numerowana.
- Step 3 — „Link”: a popover asks for „URL linku”, its „Wstaw” button is disabled
  until a URL is typed, and confirming inserts `[tekst linku](<url>)` at the cursor.
  In the preview the link renders as an `<a>` opened in a new tab (`target=_blank`).
- Step 3 — „Tabela”: a 7×7 grid with a „<kolumny> × <wiersze>” label; clicking a cell
  inserts a GFM table with that many columns and rows, which the preview renders as
  `<table>`/`<th>`/`<td>`.
- Step 4: „Utwórz” closes the dialog, raises the toast **„Fiszka utworzona pomyślnie”**,
  bumps the deck badge („0 fiszek” → „1 fiszka”) and the new card renders in the deck.
  The card's own compact Markdown renderer shows the heading, list, link and table, and
  they survive a page reload. On save the client normalises the Markdown
  (`formatMarkdown`), so `GET /api/v1/flashcards?deckIds=<id>` returns the heading run
  as typed and the table re-padded (`| Miasto   | Rzeka |`).
- Adjacent regression (asserted): an empty form (or a form with only the question) is
  refused with the toast „Zarówno przód jak i tył są wymagane”; the dialog stays open
  and nothing is written to the deck.
