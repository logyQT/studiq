# SEC-13 — Reguły dostępu do bazy (RLS)

- id: SEC-13
- priority: P2 ważny
- module: SEC – Autoryzacja i izolacja danych
- section: Walidacja wejścia i odporność
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Supabase Studio (http://127.0.0.1:54323) lub klucz anon.

## Steps

1. Używając klucza anon (bez sesji), wywołaj bezpośrednio REST: GET http://127.0.0.1:54321/rest/v1/profiles oraz /rest/v1/flashcards.

## Expected result

- Brak danych dla anonima (pusta lista/401) – RLS włączone na tabelach z danymi użytkowników.
