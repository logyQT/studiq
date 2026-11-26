# PUB-03 — Strona „Cennik” (/pricing) – przełącznik odbiorcy

- id: PUB-03
- priority: P1 krytyczny
- module: PUB – Strony publiczne i nawigacja ogólna
- section: Funkcje, Cennik, Kontakt, strony prawne
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Amendment (2026-11-26, B2 #1493)

The organization ladder is Launch / Hub / Campus. `team` is retired; the three rows, their prices
and the capacity comparison replace the four-tier list.

## Prerequisite (verbatim)

Brak sesji.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`manager@dev.local`, `student1@dev.local`, …).
Cennik jest publiczny, więc przypadek nie potrzebuje zalogowanego użytkownika — jego
izolowany tenant istnieje tylko jako nazwa przypadku i dowód izolacji:

```bash
bun scripts/qa-tenant.ts PUB-03 --reset   # usuń poprzedni tenant
bun scripts/qa-tenant.ts PUB-03           # seed od zera (deterministyczny)
```

- Klucz tenanta: `qa/cases/PUB-03.md::PUB-03::qa-shared` (`tenantKey` + `tenantId`, ten sam
  schemat co fixture'y e2e).
- Organizacja `qa-pub-03-shared` + manager / teacher / student (`Seed4Test!`, hasła z
  `tenant-seed.ts`), grupa `G1`. Reset i seed przed każdym niezależnym przebiegiem.
- Worker QA-suite seeduje **wspólną** bazę (`http://localhost:54421`): przed uruchomieniem
  skryptu eksportuje `NEXT_PUBLIC_SUPABASE_URL` i `SUPABASE_SERVICE_ROLE_KEY` ze shared worktree,
  bo lokalny `.env.local` worktree'a wskazuje na jego własny Supabase.
- Przeglądarka startuje z pustym stanem sesji (`storageState: { cookies: [], origins: [] }`)
  i ustawionym `NEXT_LOCALE=pl`; żaden użytkownik tenanta nie jest zalogowany.
- Spec nie zapisuje żadnych współdzielonych rekordów: katalog planów czyta tylko przez
  publiczne `GET /api/v1/subscription-plans` i porównuje z nim wyrenderowane plany.

## Steps

1. Otwórz /pricing.
2. Sprawdź przełącznik „Cennik”: dwie opcje, „Dla siebie” i „Dla organizacji”.
3. Przełącz na „Dla organizacji”, a potem z powrotem na „Dla siebie”. Sprawdź adres w pasku
   i przycisk „wstecz” przeglądarki.
4. Otwórz bezpośrednio /pricing?audience=organization.

## Expected result

- Tytuł „Wybierz swój plan” i podtytuł „Ceny miesięczne w złotych. Na każdej ścieżce zaczynasz
  za darmo.”
- Jeden przełącznik z dwiema opcjami (grupa radio, nie kafelki typów kont). Nie ma osobnych
  podstron /pricing/student, /pricing/edu ani /pricing/org.
- „Dla siebie” pokazuje jedną sekcję „Dla osób indywidualnych” z jednym porównaniem planów:
  Free, Plus, Pro, Max (klucze `free`, `plus`, `pro`, `max`). Nie ma podziału na uczniów
  i edukatorów ani drugiej tabeli porównawczej.
- „Dla organizacji” pokazuje sekcję „Dla organizacji” z planami Launch, Hub, Campus
  (katalog pobierany przez `?scope=organization` — adres przełącznika to
  `?audience=organization`).
- Plany `lite`, `guide`, `creator`, `master` i `solo` nie istnieją w katalogu
  (`GET /api/v1/subscription-plans` ich nie zwraca) i nie występują w żadnej drabince.
- Przełączenie zmienia plany bez przeładowania dokumentu, zachowuje pozycję przewinięcia
  i dopisuje do adresu `?audience=organization`; „wstecz” wraca do poprzedniego widoku.
- Zimny start /pricing?audience=organization od razu pokazuje plany organizacji — treść jest
  w HTML odpowiedzi, nie pojawia się dopiero po hydratacji.
- Link „Cennik” w nagłówku prowadzi na /pricing i pokazuje „Dla siebie”, także wtedy, gdy
  wybrana była organizacja.
