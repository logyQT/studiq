# SEC-01 — Student nie widzi treści innej grupy

- id: SEC-01
- priority: P1 krytyczny
- module: SEC – Autoryzacja i izolacja danych
- section: Izolacja między organizacjami i grupami
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

student1 (O1G1).

## Steps

1. Otwórz /app/flashcards/00000000-0000-4000-8006-000000000002 (talia O1G2T2 z innej grupy).
2. Wywołaj fetch('/api/v1/flashcards/decks/00000000-0000-4000-8006-000000000002').
3. Wywołaj fetch('/api/v1/questions/banks') i sprawdź listę.

## Expected result

- Strona: „Nie znaleziono talii”. API: 404/403, brak danych talii.
- Lista banków zawiera tylko banki dostępne dla S1 (np. O1G1T1).

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`student1@dev.local`, `O1G1`/`O1G2`,
`pass`). Przypadek potrzebuje ucznia w jednej grupie oraz treści nauczyciela
udostępnionych **innej** grupie tej samej organizacji. Tenant `content` seeduje
organizację, konto managera, nauczyciela i ucznia oraz grupę domyślną `G1`:

```bash
bun scripts/qa-tenant.ts SEC-01 --fresh
```

- Klucz tenanta: `SEC-01.md::SEC-01#<run>::qa-shared` —
  `tenantKey('qa/cases/SEC-01.md', 'SEC-01#<run>', 'qa-shared')` + `tenantId`, ten sam
  schemat co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, więc każdy niezależny
  przebieg dostaje świeżą organizację; identyfikatory są deterministyczne w obrębie
  przebiegu (bez losowych UUID).
- Organizacja i grupa `G1`: `manager` (org role `admin`), `teacher` (konto educator),
  `student` (konto student, członek `G1`), hasło `Seed4Test!`.
- Druga grupa `G2` powstaje przez API produktu (`POST /api/v1/organization/groups`) w
  trakcie przebiegu; manager dodaje nauczyciela jako `teacher` w `G1` i `G2`, bo tylko
  nauczyciel grupy może udostępnić jej treści.
- Nauczyciel tworzy przez API: talię i bank pytań udostępnione `G1` (kontrola — uczeń
  musi je widzieć) oraz talię i bank udostępnione wyłącznie `G2` („talia O1G2T2 z innej
  grupy” — uczeń nie może ich odczytać). Każda talia ma jedną fiszkę.
- Żaden globalny wiersz (ustawienia admina, flagi funkcji, plany, statystyki, singletony)
  nie jest zapisywany; specyfikacja dotyka wyłącznie wierszy własnego tenanta.
