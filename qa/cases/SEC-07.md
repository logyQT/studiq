# SEC-07 — Manager nie korzysta z API AI

- id: SEC-07
- priority: P2 ważny
- module: SEC – Autoryzacja i izolacja danych
- section: Uprawnienia ról
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

manager@dev.local.

## Steps

1. POST /api/v1/ai/chat z poprawnym ciałem.

## Expected result

- 403 FORBIDDEN (API AI dozwolone tylko dla studenta i nauczyciela).
