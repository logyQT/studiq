# STU-16 — Edycja talii

- id: STU-16
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Talie (/app/flashcards)
- prereqs: STU-15 (self-contained tenant — see Seed)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Własna talia z STU-15.

## Prerequisite context

### STU-15 — Utworzenie talii

_Warunek wstępny: Zalogowany student1._

1. Kliknij „Nowa talia”.
2. Wpisz nazwę „Biologia – rozdział 1” i opis „Komórka”.
3. Zostaw widoczność „Tylko ja” i kliknij „Utwórz”.

Expected:

- Toast „Talia utworzona”; talia widoczna na liście z 0 fiszek.
- Talia ma etykietę „Zarządzaj” (właściciel).

## Seed (QA-suite)

- Tenant: `bun scripts/qa-tenant.ts STU-16 --fresh`, profile `content`
  (`qa/tests/profiles/STU-16.json`) — its own organization, manager, teacher and student.
- Accounts: the legacy `student1@dev.local` is the tenant's `users.student`
  (`loginAs(page, tenant, 'student')`); no legacy/manual account is used.
- Content: the STU-15 prerequisite deck is created by the spec through the flashcard
  API for that student — „Biologia – rozdział 1” / „Komórka”, visibility „Tylko ja”,
  0 fiszek. The spec then walks both edit entry points of this case: the deck-menu
  „Edytuj” on `/app/flashcards` and the deck view's „Edytuj Talię”, asserting the
  „Talia zaktualizowana” toast and the new name/description on the list, in the deck
  view and through `GET /api/v1/flashcards/decks/:id`. Nothing global (plan catalogue,
  feature flags, admin settings, platform stats) is read or written.
- UI note: the deck view's menu item is „Edytuj”; the dialog it opens is titled
  „Edytuj Talię”. The list dialog is titled „Edytuj talię” and both submit with
  „Aktualizuj”.

## Steps

1. Otwórz menu talii → „Edytuj” (lub z widoku talii „Edytuj Talię”).
2. Zmień nazwę i opis; zapisz.

## Expected result

- Toast „Talia zaktualizowana”; nowa nazwa/opis widoczne na liście i w widoku talii.
