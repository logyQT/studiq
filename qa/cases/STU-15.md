# STU-15 — Utworzenie talii

- id: STU-15
- priority: P1 krytyczny
- module: STU – Panel studenta (/app)
- section: Talie (/app/flashcards)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany student1.

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`student1@dev.local`, password `pass`,
organization WSB Merito, group O1G1). The suite version uses the case's own tenant and never
the legacy account.

- Profile: `content` (`qa/tests/profiles/STU-15.json`) — one organization, one default group
  `G1`, and one account per account type: `manager`, `teacher`, `student`. The spec signs in
  as `student`.
- Seed: `bun scripts/qa-tenant.ts STU-15 --fresh` — a fresh run suffix per independent run, so
  every run gets its own org/group/users from
  `tenantKey('qa/cases/STU-15.md', 'STU-15#<suffix>', 'qa-shared')` + `tenantId(key, entity)`.
  The spec reads the ids through `loadTenant('STU-15')`; nothing global is read or written.
- Content: none up front — the case's whole subject is the first deck, created through the
  product UI. The spec asserts the tenant's deck list is empty before it starts, so a deck left
  over from another run can never satisfy the case.
- „Tylko ja”: the tenant student has no `group.manage` (only teachers/managers may share with
  groups), so the create dialog renders no visibility switch for a student and the deck is
  stored as `personal` — the „Tylko ja” state the case leaves untouched. The spec asserts the
  persisted visibility instead of a selector that does not exist on this surface.
- Owner label: „Zarządzaj” is drawn from `deck.update` over the caller's own deck, so the spec
  also seeds one group deck shared to `G1` by the tenant manager (the group's teacher) and
  checks that the same student sees „Przeglądaj” on it, while its own deck keeps „Zarządzaj”.

## Steps

1. Kliknij „Nowa talia”.
2. Wpisz nazwę „Biologia – rozdział 1” i opis „Komórka”.
3. Zostaw widoczność „Tylko ja” i kliknij „Utwórz”.

## Expected result

- Toast „Talia utworzona”; talia widoczna na liście z 0 fiszek.
- Talia ma etykietę „Zarządzaj” (właściciel).
