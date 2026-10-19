# ONB-10 — Limit członków organizacji przy akceptacji zaproszeń

- id: ONB-10
- priority: P1 krytyczny
- module: ONB – Onboarding, organizacje i zaproszenia
- section: Zaproszenie przez link (/join?token=…)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

WSB Merito ma 4 członków (M1, T1, T2, S1); plan Launch ma limit 5. Przygotuj 2 nowe zaproszenia.

## Steps

1. Jako manager@dev.local (WSB Merito) wyślij zaproszenia na dwa nowe adresy (rola „member”).
2. Zaakceptuj pierwsze zaproszenie (rejestracja / dołączenie).
3. Zaakceptuj drugie zaproszenie.

## Expected result

- Pierwsze dołączenie się udaje (5 z 5 członków).
- Drugie jest odrzucone błędem limitu (kod USAGE_LIMIT_EXCEEDED / HTTP 429, komunikat o przekroczeniu limitu) – licznik obejmuje WSZYSTKICH członków organizacji (także nauczycieli i admina).
- Użytkownik drugiego zaproszenia nie jest dodany do org_members.
