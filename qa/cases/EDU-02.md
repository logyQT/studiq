# EDU-02 — Menu boczne nauczyciela

- id: EDU-02
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Pulpit i nawigacja
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany teacher1@dev.local.

## Prereqs (tenant model)

The case's own tenant, seeded by `__tests__/qa/EDU/EDU-02.spec.ts` (never the legacy
`teacher1@dev.local` / `pass` account):

- key: `tenantKey('qa/cases/EDU-02.md', 'EDU-02 teacher sidebar', 'qa-shared')::<run suffix>`
- an organization with the default group `G1`, put on the `hub` plan through
  `apply_org_plan` so its resolved features grant `group.manage` (the case's „plan Lite”)
  and `ai.chat` (the case's „Asystent Q”);
- members: an admin, a student, an educator with the org role `teacher`
  (`teacher` — the manual seed's T1) and an educator with the org role `member`
  (`teacher2`) whose resolved features have `ai.chat` but no `group.manage` — the
  control for „Grupy widoczne przy `group.read`, zapis tylko przy `group.manage`”.

Every org/user/group id is `tenantId(key, entity)`; nothing global is written.

## Steps

1. Sprawdź i kliknij każdą pozycję menu.

## Expected result

- Sekcje: Główne (Przegląd, Asystent Q), Treści (Talie, Tematy, Pytania, Testy, Kartkówki, Zgłoszenia, Grupy), Statystyki (Treści, Wyniki, Aktywność).
- „Grupy” widoczne, gdy rola ma uprawnienie `group.read` (to samo, którego pilnują trasy klas) —
  nie gdy plan ma funkcję `group.manage`. Rola `member` widzi więc pozycję i listę klas tylko
  do czytania; `group.manage` steruje przyciskami zapisu wewnątrz (T1 ma oba).
- Pozycje związane z „Klasą” są ukryte w interfejsie (sekcja zakomentowana).
- ZNANY PROBLEM: „Asystent Q” prowadzi do /edu/ai – sprawdź, czy strona istnieje (spodziewane: 404 „Nie znaleziono strony”, bo zdefiniowano tylko /app/ai).

## Reconciliation notes (walk of 2026-10-28)

- **The „ZNANY PROBLEM” is fixed.** `/edu/ai` exists („fix(web): add /edu/ai route…”,
  #433) and renders the assistant: greeting „Cześć, …”, the suggestions and the
  „Zapytaj Q” composer. The intended behaviour of the menu item is therefore a working
  page, not the predicted 404, and the spec asserts exactly that.
- The same change gated „Asystent Q” behind the `ai.chat` feature. Lite grants only
  `flashcards`, `quiz`, `group.manage` and `member.manage`, so a Lite-only teacher would
  not see the item at all and the expected menu above would be unreachable. The fixture
  therefore uses an organization plan that grants both `ai.chat` and `group.manage`.
- Every organization plan includes `group.manage`, so the „only when” clause was
  exercised through the org role (`member` → no `group.manage`). Since 2b-2 the
  sidebar item is gated on the `group.read` permission instead, because that is
  what `GET /organization/groups` asks for: the `member` role keeps „Grupy” and
  reaches a read-only list, and every write control inside stays governed by
  `group.manage`. The spec pins both halves — the entry present, „Nowa grupa”
  absent.
- The „Klasa” section is still commented out in `app-sidebar.tsx`; the sidebar renders no
  classroom group and no `/edu/classroom` link.
