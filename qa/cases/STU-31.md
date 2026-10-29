# STU-31 — Lista banków pytań studenta

- id: STU-31
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Pytania i banki (/app/questions)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany student-classroom@dev.local.

## Seed — tenant model (reconciled with the suite seeder)

The legacy prerequisite names the manual seed account `student-classroom@dev.local`
(password `pass`, organization „Classroom”, group „Classroom Group”, banks „Historia” and
„Geografia i Nauka”). The automated case never uses that account; it runs on its own tenant:

```bash
bun scripts/qa-tenant.ts STU-31 --fresh
# __tests__/qa/profiles/STU-31.json → "content"
```

That gives the student under test its own organization `qa-stu-31-<run suffix>` with a
manager, an educator and the student, plus the default group `G1` — all ids derived from
`tenantKey('qa/cases/STU-31.md', 'STU-31#<suffix>', 'qa-shared')` + `tenantId(key, entity)`.

The `content` profile seeds the graph only, so the spec builds the case's content inside
this tenant through the product API (nothing shared is read or written):

- `Historia` — 4 questions (2 multiple-choice, 1 true/false, 1 open), visibility `group`,
  shared with `G1`;
- `Geografia i Nauka` — 6 questions (2 multiple-choice, 2 true/false, 2 open), visibility
  `group`, shared with `G1`;
- `Moje notatki STU-31` — a personal bank created by the student, so the `Moje` scope and
  the group filter's narrowing are observable (with only the two group banks, `Moje` would
  be empty and the group filter would match the unfiltered list).

The two group banks are authored by the tenant's manager: in the seeded graph the manager
is the default group's `teacher` member, while the tenant educator is enrolled as a group
`member` and therefore cannot share content to a group. From the student's point of view
they are another author's banks — the student owns neither.

## Steps

1. Otwórz /app/questions.
2. Użyj filtra zakresu Wszystkie / Moje, filtra grup („Dowolna grupa” / „Moje grupy”), wyszukiwarki „Szukaj banków…” i sortowania.

## Expected result

- Widoczne banki „Historia” i „Geografia i Nauka” (grupowe) z licznikiem „N pytań” (4 i 6).
- Filtr grup zawęża listę do banków udostępnionych wybranej grupie; brak opcji „Grupy” jako zakresu.
- Etykieta „Podgląd banku” dla banków nauczyciela.

## Observations from the walk (shared app, Polish UI, 2026-10-29)

- Both group banks render on `/app/questions` with the counters as Polish plurals —
  „4 pytania” and „6 pytań” — and the group badge (`G1` in the tenant, `Classroom Group`
  in the legacy seed).
- The student does not own those banks, so the card's primary action is „Podgląd banku”
  (read-only). A bank the student owns shows „Zarządzaj” instead.
- The scope select offers exactly „Wszystkie” and „Moje”; there is no „Grupy” scope, and
  the API rejects the retired `groupFilter` parameter with a 422 (UNPROCESSABLE_ENTITY).
- „Moje” filters to banks authored by the student; with none it shows the filtered empty
  state „Nie znaleziono banków dla wybranych filtrów”.
- The search field's shipped placeholder is „Szukaj banków...”. A miss shows
  „Nie znaleziono banków dla „<query>”” plus a „Wyczyść filtry” action, which resets the
  search, the scope and the group selection (sorting is kept).
- The group filter is the MultiSelect labelled „Dowolna grupa”, with a „Moje grupy”
  quick action that selects the student's groups and disables itself while selected.
  Selecting a group narrows the list to the banks shared with it.
- Sorting: „Najnowsze” (default), „Ostatnio zmienione”, „Najstarsze”, „Nazwa A-Z”,
  „Nazwa Z-A”. Name ordering is case-insensitive enough for the assertions here
  (Geografia → Historia → Moje notatki STU-31 ascending).
- The case's „Szukaj banków…” uses a typographic ellipsis; the shipped placeholder uses
  three periods. Cosmetic only — the spec asserts the shipped text.
