# MGR-SET-05 — Utrata brandingu po obniżeniu planu

- id: MGR-SET-05
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Ustawienia i branding (/manage/settings)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Organizacja z wgranym logo na planie Hub.

## Steps

1. W panelu admina zmień plan organizacji / wyłącz funkcję branding (ADM-OVR lub ADM-PLN).
2. Odśwież /manage.

## Expected result

- Logo przestaje być wyświetlane w przełączniku (funkcja bramkowana planem) – nawet jeśli plik pozostaje w bazie.
- W Ustawieniach pojawia się karta blokady.
