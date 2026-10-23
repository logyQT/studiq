# ADM-FLG-01 — Lista flag

- id: ADM-FLG-01
- priority: P2 ważny
- module: ADM – Panel administracyjny (apps/admin, port 4000)
- section: Flagi funkcji (/feature-flags)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Baza po resecie.

## Steps

1. Otwórz /feature-flags.

## Expected result

- Tabela: Klucz, Nazwa, Opis, Włączona, Wdrożenie %, Akcje; flagi: group.manage, member.manage, role.builder, branding + pozostałe z migracji.
- Pusta baza: „Brak flag funkcji.”
