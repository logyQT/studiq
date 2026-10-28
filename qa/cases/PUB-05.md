# PUB-05 — Strona Kontakt (/contact)

- id: PUB-05
- priority: P3 kosmetyczny
- module: PUB – Strony publiczne i nawigacja ogólna
- section: Funkcje, Cennik, Kontakt, strony prawne
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Otwórz /contact.

## Expected result

- Sekcje: Sprzedaż, Inspektor Ochrony Danych, Kariera, Wsparcie, Siedziba (StudiQ sp. z o.o., adres, NIP, KRS).
- Brak błędów, treść po polsku.

## Suite seed (tenant model)

The case's own assertions are anonymous and stateless (prereq: „Brak sesji”); the
tenant exists so the signed-in adjacency check uses a real account instead of a legacy
manual one.

- case tenant: `tenantKey('qa/cases/PUB-05.md', 'PUB-05', 'qa-shared')`
  (`PUB-05.md::PUB-05::qa-shared`)
- seed: `bun scripts/qa-tenant.ts PUB-05` (org `qa-pub-05-<hash>`, group `G1`)
- users: manager / teacher / student derived by `buildAccount(...)`, password `Seed4Test!`
- profile: `bare` — `/contact` reads no tenant data
- never use the legacy manual accounts (`manager@dev.local`, …) for this case
