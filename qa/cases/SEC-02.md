# SEC-02 — Student z innej organizacji

- id: SEC-02
- priority: P1 krytyczny
- module: SEC – Autoryzacja i izolacja danych
- section: Izolacja między organizacjami i grupami
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

student2 (UE Wrocław).

## Steps

1. Spróbuj otworzyć talię O1G1T1 (00000000-0000-4000-8006-000000000001).
2. Zapytaj API o członków własnej organizacji i o organizację O1: fetch('/api/v1/organization/00000000-0000-4000-8000-000000000001').

## Expected result

- Brak dostępu do talii i danych organizacji WSB Merito (404/403).
