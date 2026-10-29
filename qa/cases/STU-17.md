# STU-17 — Zawieszanie talii

- id: STU-17
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Talie (/app/flashcards)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Własna talia z fiszkami.

## Steps

1. Wybierz „Zawieś talię”.
2. Sprawdź listę talii; włącz „Pokaż zawieszone”.
3. Rozpocznij sesję „Ucz się”.
4. Wybierz „Przywróć talię”.

## Expected result

- Toast „Talia zawieszona”; talia znika z domyślnej listy, widoczna z plakietką „Zawieszona” po włączeniu „Pokaż zawieszone”.
- W widoku talii komunikat „Ta talia jest zawieszona. Fiszki z tej talii nie będą wyświetlane w sesjach nauki ani statystykach.”.
- Fiszki zawieszonej talii nie pojawiają się w sesjach ani statystykach.
- Po „Przywróć talię” (toast „Talia przywrócona”) wracają do nauki.

## Prereqs (tenant model)

The case was written against the legacy manual seed (`student1@dev.local`, password
`pass`, personal deck `O1S1`). The suite version uses the case's own tenant and never
the legacy accounts.

- Profile: `content` (`__tests__/qa/profiles/STU-17.json`) — one organization, one default
  group `G1`, and one account per account type: `manager` (org `admin`), `teacher` and
  the `student` under test.
- Seed: `bun scripts/qa-tenant.ts STU-17 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/users from
  `tenantKey('qa/cases/STU-17.md', 'STU-17#<suffix>', 'qa-shared')` +
  `tenantId(key, entity)`. The spec reads the ids through `loadTenant('STU-17')`.
- `student1` → the tenant `student`. Its prerequisite deck („Własna talia z fiszkami”,
  the `O1S1` analogue) is created by the spec through the product API, idempotently:
  „STU-17 talia” with three cards, owned by that student in its own organization.
- Suspension is a **per-user** preference (`suspended_decks`), so the test only reads
  and writes the student's own row for its own deck.
- Izolacja: the spec does not read or write global admin settings, feature flags,
  plans, platform stats or singleton rows, and does not touch another tenant.

## Observed during the suite walk (shared app 3010 / DB 54421, pl)

- The deck screen (`/app/flashcards`) exposes suspension in the deck card's
  „Więcej akcji: <talia>” menu: „Zawieś talię” / „Przywróć talię”. Both actions raise
  a toast („Talia zawieszona” / „Talia przywrócona”) and the deck leaves / returns to
  the default list.
- „Pokaż zawieszone” is the eye-off icon button in the toolbar: it is icon-only while
  off, and only after enabling it does it render the text label „Pokaż zawieszone”.
  With it on, the suspended deck renders with the „Zawieszona” badge next to its card
  counter („3 fiszki”); the deck card also gets `opacity-60 saturate-50`.
- The deck view (`/app/flashcards/<id>`) shows the exact notice
  „Ta talia jest zawieszona. Fiszki z tej talii nie będą wyświetlane w sesjach nauki
  ani statystykach.” above the card list; the cards themselves stay listed there.
- `/app/study/learn` („Ucz się”) with only the suspended deck available renders
  „Wszystko powtórzone!” + „Brak fiszek do powtórki i brak nowych kart. Wróć później!”
  and no „Rozpocznij naukę” button. After the restore it renders „Nowe karty”, „3 nowe
  karty dostępne do nauki” and „Rozpocznij naukę”.
- API surface behind that: `practice/new` and `practice/review` return `[]` while the
  deck is suspended (3 cards before/after), and `practice/states` reports
  `totalCards: 0` for the statistics (3 before/after).
- Note (out of the case's scope, not asserted): `practice/prepare` — the cram queue —
  still returns the suspended deck's cards when called directly with `?deckIds=…`. The
  user-facing cram picker hides the deck (the deck list excludes it), so the case's
  „sesje” requirement holds through `practice/new` / `practice/review`.
- Minor inconsistency: the deck **view**'s „Więcej akcji talii → Przywróć talię” (and
  „Zawieś talię”) flips the flag but shows **no** success toast; only the deck screen's
  action toasts. The case's toast expectation is exercised through the deck screen,
  which is where the case's step 1/4 wording lives.
