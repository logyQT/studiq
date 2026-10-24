# ADM-SEC-03 — Fail-closed w produkcji

- id: ADM-SEC-03
- priority: P2 ważny
- module: ADM – Panel administracyjny (apps/admin, port 4000)
- section: Zabezpieczenie API panelu (PEM)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Build produkcyjny: bun build:admin; bun start:admin; ADMIN_PEM_KEYS puste.

## Steps

1. Wywołaj GET /api/v1/organizations.

## Expected result

- 401 ERROR_UNAUTHORIZED (brak kluczy w produkcji = odmowa wszystkiego).
