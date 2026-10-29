# MGR-GRP-02 — Członkowie grupy – przypisywanie

- id: MGR-GRP-02
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Grupy (/manage/groups)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Grupa „Grupa C”.

## Steps

1. Kliknij „Zarządzaj członkami”, wybierz S1 i T2, zapisz.

## Expected result

- Toast „Skład grupy zaktualizowany”; liczba członków i nauczycieli w tabeli się zgadza.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`manager@dev.local`, `pass`). Przypadek
wymaga organizacji z **drugim nauczycielem** (T2), żeby rola w grupie „Nauczyciel” mogła
wynikać z roli organizacyjnej, oraz z uczniem (S1):

```bash
bun scripts/qa-tenant.ts MGR-GRP-02 --profile org-limit --fresh
```

- Mapowanie starych skrótów: M1 → `users.manager` (admin), S1 → `users.student`
  (rola org `member`), T2 → `users.teacher2` (rola org `teacher`).
- Klucz tenanta: `MGR-GRP-02.md::MGR-GRP-02#<run>::qa-shared` —
  `tenantKey('qa/cases/MGR-GRP-02.md', 'MGR-GRP-02#<run>', 'qa-shared')` + `tenantId`, ten
  sam schemat co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, więc każdy
  niezależny przebieg dostaje świeżą organizację; identyfikatory są deterministyczne w
  obrębie przebiegu (bez losowych UUID).
- Organizacja ma 4 członków (admin, `teacher`, `teacher2`, `student`) i grupę domyślną
  `G1` (4 członków, 1 nauczyciel) — służy jako kontrola izolacji: zapis składu „Grupa C”
  nie może zmienić innej grupy.
- Grupa „Grupa C” jest warunkiem wstępnym przypadku, więc spec tworzy ją przez
  `POST /api/v1/organization/groups` i startuje z pustym składem (0 członków,
  0 nauczycieli).
- Spec: `__tests__/qa/MGR/MGR-GRP-02.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl`.
- Izolacja: test czyta i zapisuje wyłącznie wiersze swojego tenanta (org, jego członkowie,
  jego grupy i składy grup); nie dotyka flag funkcji, katalogu planów, ustawień admina ani
  wierszy singletonowych.
