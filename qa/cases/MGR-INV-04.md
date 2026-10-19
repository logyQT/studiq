# MGR-INV-04 — Akceptacja zaproszenia dla istniejącego użytkownika

- id: MGR-INV-04
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Zaproszenia (/manage/invites)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zaproszenie dla student3@dev.local.

## Steps

1. Zaloguj się jako student3, wejdź na /app/join i wklej token.
2. Jako manager sprawdź listę zaproszeń (zaakceptowane) i członków.

## Expected result

- Zaproszenie ma status „Zaakceptowane”, S3 widoczny wśród członków z rolą z zaproszenia.
- Ponowne użycie tego samego tokenu jest odrzucone.
