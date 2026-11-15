# STU-14 — Lista talii – widok i filtry własności

- id: STU-14
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Talie (/app/flashcards)
- prereqs: none (self-contained tenant — see Seed)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany student1.

## Seed (QA-suite)

- Tenant: `tenantKey('qa/cases/STU-14.md', 'STU-14#<run>', 'qa-shared')` with a fresh
  run suffix per independent run; the spec seeds its own graph in `beforeAll` (no
  `qa/.tenants` file is needed, like EDU-DECK-02).
- Accounts: the legacy `student1@dev.local` is the tenant's `users.student`
  (`loginAs(page, tenant, 'student')`); no legacy/manual account is used. The
  teacher (`users.teacher`) is the org's `teacher` and the teacher of both groups.
- Organization: one org with two groups — `O1G1` (default; the student is a member
  and the teacher is its teacher) and `O1G2` (teacher is its teacher, student is
  **not** a member).
- Content (built through the flashcard API, never a shared row): `O1G1T1` — group
  deck shared with `O1G1`; `O1G2T2` — group deck shared with `O1G2`; `O1S1` — the
  student's personal deck.
- UI note: all filters live behind one button named „Filtry”; its rows are the filter
  dimensions — „Moje” (ownership) and „Grupy” (assignment) — and the retired group-scope
  options „Grupy” / „Udostępnione” are gone (#595): the API rejects the old `groupFilter`
  parameter with 422 instead of ignoring it. Ticking „Grupy” selects every group the
  student belongs to; a single group is ticked in the panel that opens beside the list,
  and the student is offered only their own groups.

## Steps

1. Otwórz /app/flashcards.
2. W przycisku „Filtry” zaznacz wiersz „Moje”, a następnie go odznacz.
3. W tym samym przycisku otwórz wiersz „Grupy”, zaznacz pojedynczą grupę w panelu obok listy, a następnie wyczyść wybór.

## Expected result

- Widoczne talie: „O1G1T1” (grupowa, od T1) oraz „O1S1” (osobista).
- Talia „O1G2T2” NIE jest widoczna (inna grupa).
- „Moje” = tylko O1S1; zaznaczenie wiersza „Grupy” obejmuje wszystkie grupy studenta i zawęża listę do talii im udostępnionych, a pojedyncza grupa „O1G1” w panelu zawęża listę do talii udostępnionych tej grupie; brak opcji „Udostępnione”. Plakietka grupy „O1G1” widoczna na talii grupowej.
- Licznik talii zgodny z odmianą („2 talie”).
