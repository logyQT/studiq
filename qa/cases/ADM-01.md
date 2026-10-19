# ADM-01 — Pulpit panelu admina

- id: ADM-01
- priority: P2 ważny
- module: ADM – Panel administracyjny (apps/admin, port 4000)
- section: Pulpit i nawigacja
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

bun dev:admin; ADMIN_PEM_KEYS puste.

## Steps

1. Otwórz http://localhost:4000.
2. Kliknij kafelki sekcji.

## Expected result

- Tytuł „Administracja Systemem”, kafelki: Funkcje, Plany subskrypcji, Nadpisania użytkowników, Organizacje.
- Każdy kafelek prowadzi do właściwej sekcji.
