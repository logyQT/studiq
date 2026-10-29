# EDU-Q-01 — Utworzenie banku dla grupy

- id: EDU-Q-01
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Banki pytań i pytania (/edu/questions)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

T1 w WSB Merito.

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`teacher1@dev.local`,
`student1..3`, password `pass`, organization WSB Merito, group `O1G1`). The suite
version uses the case's own tenant and never the legacy accounts.

- The spec seeds its own graph through the shared seeder
  (`__tests__/helpers/tenant-seed.ts`), because the shape is case-specific: key
  `tenantKey('qa/cases/EDU-Q-01.md', 'EDU-Q-01 group question bank', 'qa-shared')::<run>`
  with a fresh run suffix per independent run, and `tenantId(key, entity)` for every id.
- Accounts: `teacher` (account type `educator`, org role `teacher` — it holds
  `question_bank.create` and `group.manage`, and only a group `teacher` may share
  content to a group), `studentIn` (org member, member of `G1` = the case's
  student1), `studentOut` (org member of `G2` only = the case's „student spoza
  grupy”). The seeder enrols every member in the default group, so the spec moves
  that single membership row to `G2` (tenant-local, deterministic id).
- `O1G1` → the tenant's default group `G1`; the second group `G2` exists so a member
  of the same organization is demonstrably outside the share, and so the group
  multi-select has more than one option.
- The teacher creates „Fizyka” through the UI (the case's own step); the two extra
  banks the filter step needs („Chemia” shared to `G2`, „Biologia” personal) are
  created through the product API, idempotently.
- Isolation: the spec reads/writes no global admin setting, feature flag, plan,
  platform stat or singleton row, and does not touch another tenant.

## Observed during the suite walk (shared app 3010 / DB 54421, worker qa-env-4, pl)

- „Nowy bank” opens the dialog „Nowy bank” / „Utwórz” with „Nazwa”, „Opis” and
  „Widoczność” („Tylko ja” / „Grupy”); choosing „Grupy” reveals the group
  multi-select „Wybierz grupy...”, which lists the active organization's groups only
  (`G1`, `G2`). „Utwórz” answers the toast „Bank pytań utworzony”.
- The created card shows the description, the `G1` badge, „0 pytań” and „Zarządzaj”
  for its author; the API stores `visibility: 'group'` with `groupIds: [G1]` and the
  tenant `organization_id`.
- The `G1` student's `/app/questions` lists the same card with the `G1` badge and
  „Podgląd banku” (no „Zarządzaj”). The detail shows the notice „Podgląd banku.
  Pytania może dodawać i zmieniać tylko jego autor lub nauczyciel.”, no „Utwórz
  pytanie”, and the empty row „Brak pytań w tym banku.”.
- The `G2` student's `/app/questions` does not render the bank and
  `GET /api/v1/questions/banks/<id>` answers **404 NOT_FOUND**.
- Toolbar: scope select with exactly „Wszystkie” / „Moje” (no „Grupy”, no
  „Udostępnione”), one group multi-select with the „Dowolna grupa” placeholder and a
  „Moje grupy” quick action. Selecting `G1` leaves only the `G1` bank; „Moje grupy”
  selects `G1` + `G2` (both group banks, the personal one filtered out) and disables
  itself; „Moje” keeps the educator's own banks and sends `owner=mine`.
- The retired `groupFilter` scope is rejected: `GET /api/v1/questions/banks?groupFilter=mine`
  → 422 `UNPROCESSABLE_ENTITY` (it is not silently ignored).

## Steps

1. Kliknij „Nowy bank”, nazwa „Fizyka”, opis opcjonalny, widoczność „Grupy” → O1G1.
2. Zapisz.
3. Sprawdź widok studenta1 (/app/questions).
4. Na /edu/questions sprawdź filtr zakresu Wszystkie / Moje i filtr grup („Dowolna grupa” / „Moje grupy”).

## Expected result

- Toast „Bank pytań utworzony”; student1 widzi bank z etykietą „Podgląd banku”.
- Student spoza grupy nie widzi banku.
- Filtry banków: Wszystkie / Moje + multi-select grup; brak „Grupy” jako zakresu.
