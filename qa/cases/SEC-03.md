# SEC-03 — Użytkownik bez organizacji (S3)

- id: SEC-03
- priority: P2 ważny
- module: SEC – Autoryzacja i izolacja danych
- section: Izolacja między organizacjami i grupami
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

student3.

## Prerequisite context (tenant model)

„student3” to konto studenta **bez organizacji** (B2C) z jedną osobistą talią „S3”.
Organizacja `O1` i jej grupa `O1G1` istnieją niezależnie i mają własną talię „O1G1T1”
oraz — na potrzeby kroku 1 — udostępniony grupie bank pytań „O1G1B1”. Podmiot przypadku
nie należy do `O1` ani do `O1G1`.

## Seed (QA-suite tenant)

Automatyzacja nie używa konta `student3@dev.local` ani hasła `pass`. Każde niezależne
uruchomienie dostaje własny, świeżo zaseedowany tenant:

```bash
bun scripts/qa-tenant.ts SEC-03 --fresh
```

- Profil tenanta: `qa/tests/profiles/SEC-03.json` = `"org-limit"` — organizacja z adminem
  (prowadzącym grupę `G1`), dwoma nauczycielami i członkiem oraz **dwoma kontami studentów
  spoza organizacji** (`invitee1`, `invitee2`). To jedyny profil, który daje jednocześnie
  istniejącą organizację z treściami i konto studenta bez organizacji.
- Klucz tenanta: `qa/cases/SEC-03.md::SEC-03#<run>::qa-shared`
  (`tenantKey('qa/cases/SEC-03.md', 'SEC-03#<run>', 'qa-shared')`, `tenantId` dla każdego
  id) — ten sam schemat co fixture'y e2e, bez nowego schematu ID.
- `student3` → `invitee1` (student bez organizacji; `GET /api/v1/me/orgs` = `[]`), jego
  własna talia „S3” tworzona przez API w jego sesji.
- Pozytywna kontrola: `student` — faktyczny członek `G1`, który nadal widzi „O1G1T1”,
  jego fiszki i bank „O1G1B1”.
- Organizacja `O1` = organizacja tenanta, grupa `O1G1` = `G1`. Talię „O1G1T1” (widoczność
  `group`, udostępniona do `G1`, z dwiema fiszkami) i bank „O1G1B1” tworzy admin
  organizacji: w tym profilu tylko on jest nauczycielem grupy, a `canShareContentToGroups`
  dopuszcza udostępnianie wyłącznie przez grupowych nauczycieli.
- Izolacja: spec nie czyta ani nie zapisuje globalnych ustawień admina, flag funkcji,
  planów, statystyk platformy ani wierszy singletonowych; nie dotyka innego tenanta.

## Observed during the suite walk (shared app 3010 / DB 54421, pl)

- `student3` bez organizacji: `/app/flashcards` pokazuje „1 talia” i wyłącznie kartę
  „S3”; `/app/questions` pokazuje pusty stan „Nic tu jeszcze nie ma, utwórz swój pierwszy
  bank pytań!”. Treści `O1` nie są renderowane.
- `GET /api/v1/flashcards/decks` zwraca tylko talię „S3” (organization_id = null).
- `GET /api/v1/flashcards/decks/<O1G1T1>`, `GET /api/v1/flashcards/<fiszka>` i
  `GET /api/v1/questions/banks/<O1G1B1>` zwracają **404 NOT_FOUND** bez treści w `data`;
  wymuszony `PUT` nazwy talii również 404 (izolacja nie jest tylko do odczytu).
- Członek `G1` nadal odczytuje tę samą talię, fiszki i bank po próbach obcego konta —
  pozytywna kontrola, że 404 wynika z granicy uprawnień, a nie z braku danych.

## Steps

1. Otwórz /app/flashcards oraz /app/questions.
2. Spróbuj odczytać talię O1G1T1 przez API.

## Expected result

- Widzi wyłącznie własną talię „S3”; treści organizacji O1 niedostępne.
