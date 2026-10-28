# ONB-07 — Przełączanie organizacji (M1 / T1)

- id: ONB-07
- priority: P1 krytyczny
- module: ONB – Onboarding, organizacje i zaproszenia
- section: Student – dołączenie do klasy, przełączanie organizacji
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany teacher1@dev.local (członek WSB Merito i UE Wrocław).

## Prerequisite context (tenant model)

The verbatim prerequisite names the legacy manual seed. The automated case owns a seeded
tenant instead:

- **Tenant key**: `tenantKey('qa/cases/ONB-07.md', 'ONB-07 switching organizations updates
the visible content', 'qa-shared')` plus a per-run suffix (`QA_RUN_SUFFIX`, otherwise
  fresh). Every org/user/group/bank/deck id is `tenantId(key, entity)`.
- **Organizations**: two orgs, `… A` and `… B`. Each has two teacher-led groups, two
  question banks and two flashcard decks, all with names unique to the run.
- **User** (password `Seed4Test!`): `teacher` (educator), a member of both orgs with the
  `teacher` org role — the tenant counterpart of T1's two memberships.
- **Foreign org**: a third org with no membership for this teacher, used to assert the
  switch endpoint refuses a non-member org.
- **Profile**: `content` (groups/banks/decks in both orgs); no quizzes, assignments or
  students are needed for this case.
- The spec seeds the graph at run time with the shared helpers
  (`__tests__/helpers/tenant-seed.ts`) because every independent run needs its own
  two-org tenant and its own per-org content.

## Steps

1. Rozwiń przełącznik organizacji i sprawdź listę.
2. Przełącz na drugą organizację.
3. Wejdź na Pytania / Fiszki / Grupy i porównaj widoczne treści.
4. Przełącz z powrotem.

## Expected result

- Lista zawiera „WSB Merito” i „UE Wrocław” z rolą „Teacher” i zaznaczoną aktywną (✓).
- Po przełączeniu następuje przekierowanie na pulpit /edu.
- Dane widoczne dla aktywnej organizacji różnią się (np. banki O1G1T1/O1G2T2 vs O2G1T1/O2G2T2; grupy O1G1/O1G2 vs O2G1/O2G2).
- Dane organizacji nieaktywnej nie są widoczne (izolacja).

## Walk observations (shared app, pl)

- The switcher lives at the top of the `/edu` sidebar: the trigger shows the active org
  and its role (`Teacher`); the menu label is „Organizacje”, both memberships are listed
  with `Teacher`, and only the active one carries the check glyph.
- Choosing an org from any `/edu` page (dashboard, questions, flashcards, groups) closes
  the menu and pushes `/edu`; `GET /api/v1/me/orgs` then reports the new org as `isActive`.
- Content surfaces: `/edu/questions` (Pytania) renders bank cards with their group badges,
  `/edu/flashcards` (Talie) renders deck cards, `/edu/groups` (Grupy) renders the org's
  group table.
- Isolation is server-side, not just visual: `/api/v1/questions/banks`,
  `/api/v1/flashcards/decks` and `/api/v1/organization/groups` return only the active
  org's rows, and a reload keeps the switched org (the `active_org_id` cookie).
- An org the teacher is not a member of never appears in the menu, and
  `POST /api/v1/me/orgs/switch` rejects it with 404 without changing the active org.
