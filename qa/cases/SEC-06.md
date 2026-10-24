# SEC-06 — Student/nauczyciel nie zarządza organizacją

- id: SEC-06
- priority: P1 krytyczny
- module: SEC – Autoryzacja i izolacja danych
- section: Uprawnienia ról
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

student1 i teacher1.

## Steps

1. Jako student1: PUT /api/v1/organization/members; POST /api/v1/organization/invites/bulk; POST /api/v1/organization/roles.
2. Jako teacher1: to samo.

## Expected result

- Operacje odrzucone (403) – brak zmian ról/zaproszeń/ról niestandardowych.
