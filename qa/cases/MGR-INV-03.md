# MGR-INV-03 — Anulowanie zaproszenia

- id: MGR-INV-03
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Zaproszenia (/manage/invites)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Oczekujące zaproszenie.

## Steps

1. Kliknij „Anuluj” w wierszu zaproszenia; w oknie „Anulować zaproszenie?” potwierdź.
2. Spróbuj użyć wcześniej skopiowanego linku /join?token=….

## Expected result

- Toast „Zaproszenie anulowane”, wiersz znika z listy oczekujących.
- Link zaproszenia przestaje działać (nieprawidłowy token – ONB-09).
