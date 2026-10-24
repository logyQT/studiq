# SEC-04 — Manager jednej organizacji nie zarządza inną

- id: SEC-04
- priority: P1 krytyczny
- module: SEC – Autoryzacja i izolacja danych
- section: Izolacja między organizacjami i grupami
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

manager2 (Akademia Górnicza).

## Steps

1. Wywołaj fetch('/api/v1/organization/members') i sprawdź członków.
2. Spróbuj zmienić rolę użytkownika z WSB Merito: PUT /api/v1/organization/members {targetUserId:<S1 UUID>, newOrgRoleId:<rola>}.
3. Otwórz /api/v1/organization/00000000-0000-4000-8000-000000000001.

## Expected result

- Lista członków obejmuje tylko Akademię Górniczą.
- Próba zmiany roli cudzego użytkownika – odrzucona (403/404).
- Dane innej organizacji niedostępne.
