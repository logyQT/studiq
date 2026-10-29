# STU-27 — Usuwanie fiszki

- id: STU-27
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Fiszki w talii (/app/flashcards/<id>)
- prereqs: none (self-contained tenant — see Prereqs)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Talia z fiszką.

## Steps

1. Wybierz „Usuń” przy fiszce, potwierdź.

## Expected result

- Okno „Usunąć Fiszkę?” – „To trwale usunie fiszkę. Tej akcji nie można cofnąć.”; po potwierdzeniu toast „Fiszka usunięta”.

## Prereqs (tenant model)

The case was written against the legacy manual seed (`student1@dev.local`, password
`pass`, personal deck `O1S1`). The suite version uses the case's own tenant and never
the legacy accounts.

- Profile: `content` (`qa/tests/profiles/STU-27.json`) — one organization, one default
  group `G1`, and one account per account type: `manager` (org `admin`), `teacher` and
  the `student` under test.
- Seed: `bun scripts/qa-tenant.ts STU-27 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/users from
  `tenantKey('qa/cases/STU-27.md', 'STU-27#<suffix>', 'qa-shared')` + `tenantId(key, entity)`.
  The spec reads the ids through `loadTenant('STU-27')`.
- `student1` → the tenant `student`. Its prerequisite deck with a flashcard („Talia z
  fiszką”, the `O1S1` analogue) is created by the spec through the product API:
  `POST /api/v1/flashcards/decks` „STU-27 usuwanie <suffix>”, then two cards on it. The
  case then drives the UI on `/app/flashcards/<deckId>`.
- Two cards, not one: the second one stays in the deck through the whole scenario, so
  the spec proves that confirming the dialog deletes exactly the chosen card and not the
  deck's grid.
- Nothing global is read or written — no admin setting, feature flag, plan, platform
  stat or singleton row — and no other tenant is touched. Every run works on the deck it
  just created, so a CI retry that reuses the seeded tenant cannot collide with a
  previous attempt's cards.

## Observed during the suite walk (shared app 3010 / DB 54421, worker qa-env-4, pl)

- Step 1 — the delete action is in the card's overflow menu, not a visible per-card
  button: „Więcej akcji fiszki” (⋮, revealed on hover) → „Usuń” (red, below a separator,
  last entry after „Wybierz Fiszki”, „Edytuj”, „Tematy”, „Przenieś do Innej Talii”,
  „Kopiuj do Innej Talii”).
- The confirmation dialog matches the case copy verbatim: title **„Usunąć Fiszkę?”**,
  description **„To trwale usunie fiszkę. Tej akcji nie można cofnąć.”**, actions
  „Anuluj” / „Usuń” (destructive) plus the dialog's ✕ close button.
- Confirming raises the toast **„Fiszka usunięta”** (sonner, top center, green), closes
  the dialog, removes the card from the grid and decrements the deck badge
  („2 fiszki” → „1 fiszka”; on an empty deck „0 fiszek” with the empty state „Nic tutaj
  jeszcze nie ma, stwórz swoją pierwszą fiszkę!”). The other card stays untouched and
  the deletion survives a reload.
- „Anuluj” (and ✕) close the dialog without deleting: the card stays, no toast appears
  and the API still returns both cards.
- API: `DELETE /api/v1/flashcards/<id>` → 200 `{ success: true }`; the card is gone from
  `GET /api/v1/flashcards?deckIds=<deck>`, and a second `DELETE` of the same id → 404.
