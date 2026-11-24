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
  `change_org_plan` so its resolved features grant `ai.chat` (the case's
  „Asystent Q”) and the other Hub surfaces;
- members: an admin, a student, an educator with the org role `teacher`
  (`teacher` — the manual seed's T1, which carries the `group.manage`
  permission at `group` scope) and an educator with the org role `member`
  (`teacher2`) whose entitlements have `ai.chat` but whose permission map has
  no `group.manage` — the control for „Grupy widoczne przy `group.read`, zapis
  tylko przy `group.manage`”.

Every org/user/group id is `tenantId(key, entity)`; nothing global is written.

## Steps

1. Sprawdź i kliknij każdą pozycję menu.

## Expected result

- Sekcje: Główne (Przegląd, Asystent Q), Treści (Talie, Tematy, Pytania, Testy, Kartkówki, Zgłoszenia, Grupy), Statystyki (Treści, Wyniki, Aktywność).
- „Grupy” widoczne, gdy rola ma uprawnienie `group.read` (to samo, którego pilnują trasy klas) —
  `group.manage` (od 2b-7 występuje tylko jako uprawnienie) steruje przyciskami
  zapisu wewnątrz (T1 ma oba). Rola `member` widzi więc pozycję i listę klas tylko
  do czytania.
- Pozycje związane z „Klasą” są ukryte w interfejsie (sekcja zakomentowana).
- ZNANY PROBLEM: „Asystent Q” prowadzi do /edu/ai – sprawdź, czy strona istnieje (spodziewane: 404 „Nie znaleziono strony”, bo zdefiniowano tylko /app/ai).

## Reconciliation notes (walk of 2026-10-28)

- **The „ZNANY PROBLEM” is fixed.** `/edu/ai` exists („fix(web): add /edu/ai route…”,
  #433) and renders the assistant: greeting „Cześć, …”, the suggestions and the
  „Zapytaj Q” composer. The intended behaviour of the menu item is therefore a working
  page, not the predicted 404, and the spec asserts exactly that.
- The same change gated „Asystent Q” behind the `ai.chat` feature, so the fixture
  uses an organization plan that grants it (Hub).
- Since 2b-2 the sidebar item is gated on the `group.read` permission, because that
  is what `GET /organization/groups` asks for: the `member` role keeps „Grupy” and
  reaches a read-only list, and every write control inside stays governed by
  `group.manage`. Since 2b-7 that key exists only as a permission — the four legacy
  management markers left the entitlement catalog — so the „only when” clause is
  exercised through the role's permission map (`/api/v1/me/permissions`):
  `teacher` → `group.manage` at `group` scope, `member` → no `group.manage` at any
  scope. The spec pins both halves — the entry present, „Nowa grupa” absent.
- The „Klasa” section is still commented out in `app-sidebar.tsx`; the sidebar renders no
  classroom group and no `/edu/classroom` link.
- Landing (2026-11-24, ADR-0015 §7.1): `/login` wybiera obszar na podstawie
  uprawnień aktywnej organizacji. `teacher2` ma rolę `member` (tylko `group.read`),
  więc ląduje na `/app`; przypadek otwiera `/edu` jawnie (trasa wymaga tylko
  zalogowania), a menu i kontrolki czyta z powłoki nauczyciela. `teacher` ma rolę
  `teacher` (`group.manage`), więc nadal ląduje na `/edu`.

## Reconciliation notes (2026-11-24, 6b-2)

- Każda pozycja sekcji „Treści” ma od 6b-2 własny klucz uprawnienia zamiast
  wspólnego bramkowania po planie: „Talie” → `deck.read`, „Tematy” → `topic.read`,
  „Pytania” → `question.bank.read`, „Testy” → `quiz.read`, „Kartkówki” →
  `assignment.read`, „Grupy” → `group.read` (bez zmian: to nadal klucz, którego
  pilnują trasy klas). Rola systemowa `member` nie zawiera rodzin
  `assignment.*`, więc **nauczyciel z rolą `member` nie widzi „Kartkówki”** —
  pozostałe pozycje widzi, bo `…read` ma na zakresie `group`, a `stats.read` na
  `own` (pozycja pyta, czy klucz jest w mapie, nie o zakres). Lista z sekcji
  „Expected result” pozostaje listą nauczyciela z rolą `teacher` (T1), który ma
  wszystkie klucze.
- Spec pinuje obie połowy: pierwszy test (rola `teacher`) oczekuje pełnej listy
  z „Kartkówki”, drugi (rola `member`) — tej samej listy bez tej pozycji oraz
  braku linku `/edu/assignments`; reszta asercji (mapa `group.read` bez
  `group.manage`, „Grupy”, „Asystent Q”, brak „Klasy”, brak „Nowa grupa”) się nie
  zmienia.
