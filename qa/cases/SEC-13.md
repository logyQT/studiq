# SEC-13 — Reguły dostępu do bazy (RLS)

- id: SEC-13
- priority: P2 ważny
- module: SEC – Autoryzacja i izolacja danych
- section: Walidacja wejścia i odporność
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Supabase Studio (http://127.0.0.1:54323) lub klucz anon.

## Prerequisite context (tenant model)

Klucz anonimowy (anon) wspólnego Supabase QA (`qa/env.json` → `http://localhost:54421`,
ten sam, którego używa aplikacja pod `http://localhost:3010`) i **bez sesji** — żadnego
JWT użytkownika ani ciasteczka logowania. Dane, które nie mogą wyciec, należą do tenanta
przypadku: trzy wiersze `profiles` (manager, nauczyciel, student) oraz osobista talia
studenta z jedną fiszką (wiersze `flashcard_decks` i `flashcards`).

## Seed (QA-suite tenant)

Automatyzacja nie używa kont `@dev.local` ani hasła `pass`; każde niezależne uruchomienie
dostaje własny, świeżo zaseedowany tenant:

```bash
bun scripts/qa-tenant.ts SEC-13 --fresh
```

- Profil tenanta: `qa/tests/profiles/SEC-13.json` = `"content"` — organizacja z managerem,
  nauczycielem i studentem (czyli trzy realne wiersze `profiles`) oraz grupa `G1`.
- Klucz tenanta: `qa/cases/SEC-13.md::SEC-13#<run>::qa-shared`
  (`tenantKey('qa/cases/SEC-13.md', 'SEC-13#<run>', 'qa-shared')`, `tenantId` dla każdego
  id) — ten sam schemat co fixture'y e2e, bez nowego schematu ID.
- Dane „użytkownika” w kroku 1: student tworzy przez API produktu osobistą talię
  `SEC-13 deck <run>` i fiszkę `SEC-13 front <run>` (idempotentnie po nazwie — powtórzenie
  na tym samym tenancie nie duplikuje wierszy).
- Adres REST: `http://localhost:54421/rest/v1/{profiles,flashcards,flashcard_decks}` z
  nagłówkiem `apikey` i `Authorization: Bearer <anon>`; brak sesji użytkownika.
- Izolacja: spec nie czyta ani nie zapisuje globalnych ustawień admina, flag funkcji,
  planów, statystyk platformy ani wierszy singletonowych; nie dotyka innego tenanta.
  `rls_audit()` (service role) czyta wyłącznie metadane katalogu (flagę RLS i uprawnienia
  `anon`), nie wiersze tenanta.

## Observed during the suite walk (shared app 3010 / DB 54421, en/pl, 2026-10-29)

- `GET /rest/v1/profiles` i `GET /rest/v1/flashcards` z kluczem anon, bez sesji →
  **401** `{"code":"42501","message":"permission denied for table profiles|flashcards"}`.
  Żadnego `email`, `id` ani treści fiszki w odpowiedzi.
- To samo dla zgadywanego id: `GET /rest/v1/profiles?id=eq.<student>`,
  `GET /rest/v1/flashcards?id=eq.<fiszka>` i `GET /rest/v1/flashcard_decks?id=eq.<talia>`
  → **401 42501**.
- Ten sam klucz anon czyta publiczne tabele cennika (`subscription_plans`) → **200**;
  więc 401 na danych użytkownika to autoryzacja per tabela, nie zły klucz/adres.
- Pozytywna kontrola: ten sam klucz anon + realna sesja studenta (GoTrue password grant)
  czyta własny wiersz `profiles` i fiszkę, której anon nie widzi → **200** z danymi.
- `rls_audit()`: `profiles`, `flashcards`, `flashcard_decks` mają `rls_enabled = true`
  oraz `anon_select = false` / `anon_insert = false`.

## Steps

1. Używając klucza anon (bez sesji), wywołaj bezpośrednio REST: GET http://127.0.0.1:54321/rest/v1/profiles oraz /rest/v1/flashcards.

## Expected result

- Brak danych dla anonima (pusta lista/401) – RLS włączone na tabelach z danymi użytkowników.
