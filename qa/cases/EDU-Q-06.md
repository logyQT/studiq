# EDU-Q-06 — Utworzenie fiszki z pytania

- id: EDU-Q-06
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Banki pytań i pytania (/edu/questions)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Bank z pytaniami.

## Tenant (QA suite)

The case runs on its own `content` tenant, not on the legacy manual seed
(`teacher1@dev.local`, `student1@dev.local`, `O1G1`, password `pass`). The shape is
declared in `qa/tests/profiles/EDU-Q-06.json` and seeded with:

```bash
bun scripts/qa-tenant.ts EDU-Q-06 --fresh
```

- organization `qa-edu-q-06-<suffix>` (plan `Launch`) with group `G1`
- users: `manager`, `teacher` (educator) and `student` (org member, `G1` member);
  the default password is `Seed4Test!`
- every id is deterministic from
  `tenantKey('qa/cases/EDU-Q-06.md', 'EDU-Q-06#<suffix>', 'qa-shared')` +
  `tenantId`, so the tenant never reads or writes a global setting, plan, feature
  flag or singleton row.

The seeder builds only the org/group/user graph, so the spec prepares the case's
content through the product API inside that tenant: a group question bank shared to
`G1` with one MCQ question („EDU-Q-06 Jaka jest stolica Francji?”, correct answer
„Paryż”) and a group deck shared to `G1`. Only a group `teacher` may share content,
so the spec first promotes the seeded educator through the manager's group roster
(the same write `/manage/groups` performs); group membership itself already exists.

The legacy prerequisite „Bank z pytaniami.” maps to that bank + question. The
`student` above replaces S1 from the legacy seed; the report step (STU-39) uses the
same tenant, so the report must land with the educator who authored the question.

## Steps

1. W tabeli pytań kliknij ikonę „Utwórz fiszkę z tego pytania”.
2. Wybierz talię lub „Nowa talia” z nazwą i zapisz.
3. Jako student z grupy zgłoś nieprawidłowość tej fiszki (STU-39).

## Expected result

- Fiszka powstaje z przodem = treść pytania, tyłem = poprawna odpowiedź.
- Fiszka jest powiązana z pytaniem: zgłoszenie studenta trafia do autora pytania.

## Observed on the shared app (worker qa-env-5)

- The question row carries the icon with the tooltip/accessible name „Utwórz fiszkę
  z tego pytania”; the dialog is titled „Utwórz fiszkę z pytania”, explains the
  question link and prefills „Przód (Pytanie)” / „Tył (Odpowiedź)”.
- Deck picker lists the tenant's decks plus „+ Nowa talia”; creating a new deck from
  the dialog yields a personal deck holding the card, and the toast is „Fiszka
  utworzona”. Picking the existing group deck stores the card with `group` visibility.
- The `G1` student sees the card in `/app/flashcards/<deck>`; only a card linked to a
  question offers „Zgłoś nieprawidłowość” (a standalone card does not). The report
  dialog is „Zgłoś nieprawidłowość pytania”, the toast is „Zgłoszenie wysłane”, and the
  report appears on the author's `/edu/reports` list with the question content and
  status „Otwarte”.
