# EDU-DECK-01 — Hub fiszek (/edu/flashcards)

- id: EDU-DECK-01
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Talie i fiszki nauczyciela
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany teacher1@dev.local.

## Steps

1. Otwórz /edu/flashcards.
2. Sprawdź listę talii, filtr zakresu (Wszystkie / Moje) i filtr grup.

## Expected result

- Tytuł „Talie fiszek”, filtr zakresu: Wszystkie / Moje oraz jeden filtr grup z placeholderem „Dowolna grupa” (i akcją „Moje grupy”, gdy użytkownik należy do grup). Brak opcji „Grupy” i „Udostępnione”.
- T1 widzi własne talie (O1G1T1, O2G1T1 zależnie od aktywnej organizacji) z plakietkami grup.
- Talie T2 (O1G2T2) widoczne zgodnie z regułami uprawnień (zanotuj – oczekiwane: tylko jeśli T1 ma dostęp organizacyjny).

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`teacher1@dev.local`, password `pass`,
organizations WSB Merito / UE Wrocław, decks `O1G1T1` / `O2G1T1`). The suite version uses the
case's own tenant and never the legacy accounts.

- Profile: `content` (`__tests__/qa/profiles/EDU-DECK-01.json`) — one organization, one default
  group `G1`, and one account per account type: `manager` (org `admin`, group `teacher`),
  `teacher` (account type `educator`, org `member`), `student`.
- Seed: `bun scripts/qa-tenant.ts EDU-DECK-01 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/group/users from
  `tenantKey('qa/cases/EDU-DECK-01.md', 'EDU-DECK-01#<suffix>', 'qa-shared')` +
  `tenantId(key, entity)`. The spec reads the ids through `loadTenant('EDU-DECK-01')`.
- Content (created by the spec through the product API, idempotently):
  - one personal deck owned by the teacher — the `O1G1T1` analogue without a group badge;
  - one group deck owned by the teacher and shared to `G1` — the `O1G1T1` analogue with a
    group badge;
  - one group deck owned by the manager and shared to `G1` — the "content shared by another
    org member" analogue (`O1G2T2`), visible to the teacher only through the group read rule.
- The tenant seeder enrolls group members as group `member`; only a group `teacher` may share
  content to a group, so the spec promotes the teacher to group `teacher` through the manager's
  own roster endpoint (`PUT /api/v1/organization/groups/:id/members`) before creating the
  deck. That write is tenant-local and idempotent (the same endpoint `/manage/groups` uses).
- Not used: the second organization / active-org switch leg of the case (`O2G1T1`). A
  single-org tenant pins one active organization, so the deck set is asserted inside this
  tenant; org switching belongs to its own case.
- T2 bullet: the seeded educator is an organization `member`, whose `deck.read` scope is
  `group`, so the manager's deck shared to `G1` is visible under „Wszystkie” and excluded by
  „Moje”. That is the permission-rule behavior asserted; no guess is encoded for a second
  teacher account.
