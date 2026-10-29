# STU-08 — Wkuwanie wybranej talii

- id: STU-08
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Nauka fiszek – „Wkuwaj” (cram)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany student1 (talie O1G1T1, O1S1).

## Steps

1. Otwórz /app/study/cram (menu „Wkuwaj”).
2. Wybierz talię i kliknij „Wkuwaj”.
3. Oceń kilka fiszek, zakończ sesję.

## Expected result

- Lista talii z licznikiem fiszek; opis „Wybierz talię i wkuwaj karty we własnym tempie”.
- Sesja w trybie „Wkuwanie” działa niezależnie od harmonogramu SM-2 (fiszki niezaległe też są dostępne).
- Po zakończeniu przyciski „Wkuj ponownie” i „Powrót do wkuwania”.

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`student1@dev.local`, password
`pass`, decks `O1G1T1` / `O1S1`). The suite version uses the case's own tenant and
never the legacy accounts.

- Profile: `content` (`__tests__/qa/profiles/STU-08.json`) — one organization, one default
  group `G1`, and one account per account type: `manager` (org `admin`), `teacher` and
  the `student` under test.
- Seed: `bun scripts/qa-tenant.ts STU-08 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/users from
  `tenantKey('qa/cases/STU-08.md', 'STU-08#<suffix>', 'qa-shared')` +
  `tenantId(key, entity)`. The spec reads the ids through `loadTenant('STU-08')`.
- `student1` → the tenant `student`. Its two personal decks are created by the spec
  through the product API, idempotently: „STU-08 wkuwanie” with three cards (the
  `O1S1` analogue for the cram walk) and „STU-08 druga” with one card, so the picker's
  per-deck counter is observable on more than one deck.
- The case's SM-2 bullet is asserted without waiting for a schedule: all cards are
  new, `practice/due/count` is 0, and `practice/prepare` still returns the whole deck
  for „Wkuwaj”; after two full cram runs `practice/states.practicedCards` is still 0
  and every card's `reviewState` is null.
- `O1G1T1` (the group/teacher deck) is out of scope here: the case is about the
  student's own deck and the cram queue, and a tenant-local personal deck exercises
  the same session surface without depending on another member's content.
- Not used: the second organization / org-switch leg of the legacy seed. A single-org
  tenant pins one active organization.
- Izolacja: the spec does not read or write global admin settings, feature flags,
  plans, platform stats or singleton rows, and does not touch another tenant.

## Observed during the suite walk (shared app 3010 / DB 54421, pl)

- `/app/study/cram` renders „Moja Nauka / Wkuwaj”, the description
  „Wybierz talię i wkuwaj karty we własnym tempie”, and one card per deck with a
  visible badge („3 fiszki”, „1 fiszka”) and a „Wkuwaj” button.
- „Wkuwaj” opens `/app/study/session/cram?deckId=<id>`: header badge „Nowa”,
  „0/0 poprawnych”, the card front with the hint „Kliknij, aby odkryć odpowiedź”, and
  the four cram ratings „Nie pamiętam (reset)”, „Dobrze (dalej)”, „Trudne (zostań)”,
  „Łatwe (zakończ)”.
- Rating every card opens the summary „Sesja zakończona!” with „N z N poprawnych”,
  the „Wkuwanie” badge and both buttons „Wkuj ponownie” / „Powrót do wkuwania”.
  „Wkuj ponownie” resets the score to 0/0 and re-queues the whole deck in place;
  „Powrót do wkuwania” lands back on `/app/study/cram`.
- After both runs `GET /api/v1/flashcards/practice/states` still reports
  `practicedCards: 0` and `neverPracticed` equal to the tenant's four cards, and
  `practice/prepare` returns every card with `reviewState: null` — cram writes no
  SM-2 state.
