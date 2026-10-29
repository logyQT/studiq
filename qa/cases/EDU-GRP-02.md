# EDU-GRP-02 — Zarządzanie członkami grupy

- id: EDU-GRP-02
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Grupy nauczyciela (/edu/groups)
- prereqs: EDU-GRP-01
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Grupa z EDU-GRP-01.

## Prerequisite context

### EDU-GRP-01 — Lista i tworzenie grup

_Warunek wstępny: T1 (plan Lite – group.manage)._

1. Otwórz /edu/groups.
2. Kliknij „Nowa grupa”, nazwa „Grupa testowa”, opis; zapisz.

Expected:

- Lista grup z kolumnami Nazwa / Członkowie / Nauczyciele / Akcje.
- Toast „Grupa utworzona”.

## Steps

1. Kliknij „Zarządzaj członkami”.
2. Wybierz osoby w polu „Wybierz osoby…”, zapisz.

## Expected result

- Dostępni są wyłącznie członkowie tej organizacji.
- Toast „Skład grupy zaktualizowany”; liczniki w tabeli aktualizują się.
- Dodany student widzi treści udostępnione tej grupie.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`teacher1@dev.local`, `student1@dev.local`,
`pass`, grupa `O1G1`). Przypadek wymaga nauczyciela, który sam zarządza grupą: w tenantach
uprawnienie `group.manage` wynika z roli organizacyjnej `teacher` (plan organizacji `launch`
seeduje je dla tej roli), a `canManage` dla grupy wymaga, by jej twórcą był zalogowany
nauczyciel.

```bash
bun scripts/qa-tenant.ts EDU-GRP-02 --fresh
```

- Profil: `org-limit` (`qa/tests/profiles/EDU-GRP-02.json`) — jedyny seedowany kształt z
  nauczycielem w roli organizacyjnej `teacher` (a więc z `group.manage`): admin
  (`users.manager`), dwóch nauczycieli (`users.teacher`, `users.teacher2`) i uczeń
  (`users.student`), plus konta `users.invitee1` / `users.invitee2`, które **nie są**
  członkami organizacji.
- Mapowanie starych skrótów: T1 → `users.teacher` (rola org `teacher`, tworzy grupę),
  S1 → `users.student` (rola org `member`), T2 → `users.teacher2` (rola org `teacher`),
  M1 → `users.manager`. Invitee 1/2 to kontrola dla „wyłącznie członkowie tej organizacji”:
  ich e-maile nie mogą pojawić się w polu „Wybierz osoby…”.
- Klucz tenanta: `tenantKey('qa/cases/EDU-GRP-02.md', 'EDU-GRP-02#<run>', 'qa-shared')` +
  `tenantId`, ten sam schemat co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, więc
  każdy niezależny przebieg dostaje świeżą organizację; identyfikatory są deterministyczne w
  obrębie przebiegu (bez losowych UUID).
- Grupa „Grupa testowa” jest warunkiem wstępnym z EDU-GRP-01, więc spec tworzy ją jako
  nauczyciel przez `POST /api/v1/organization/groups` i resetuje jej skład do pustego
  (`PUT .../members`, `members: []`) — krok 2 startuje od stanu „Wybierz osoby…”.
- Treść udostępniona grupie (oczekiwanie 3) to talia utworzona przez nauczyciela z
  `visibility: group` i `groupIds: [<grupa>]`. Udostępniać może tylko nauczyciel grupy, więc
  spec na czas tego zapisu dodaje nauczyciela do składu, a potem znów czyści skład: uczeń
  jest poza grupą do momentu zapisu, a talia jest już przypisana do grupy.
- Grupa domyślna `G1` (4 członków, 1 nauczyciel) należy do managera i służy jako kontrola
  izolacji: zapis składu „Grupa testowa” nie może zmienić jej liczników.
- Spec: `qa/tests/EDU/EDU-GRP-02.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl`.
- Izolacja: test czyta i zapisuje wyłącznie wiersze swojego tenanta (organizacja, jej
  członkowie, jej grupy i składy grup, jego talie); nie dotyka flag funkcji, katalogu
  planów, ustawień admina ani wierszy singletonowych.
