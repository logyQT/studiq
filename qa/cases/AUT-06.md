# AUT-06 — Brak aktywacji konta uniemożliwia logowanie

- id: AUT-06
- priority: P2 ważny
- module: AUT – Uwierzytelnianie i sesja
- section: Rejestracja
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Świeżo zarejestrowane konto, link nieużyty.

## Steps

1. Zarejestruj test.unconfirmed@example.com (nie klikaj linku).
2. Spróbuj się zalogować tym kontem.

## Expected result

- Logowanie jest odrzucone z czytelnym komunikatem (np. „Logowanie nie powiodło się…” lub o niepotwierdzonym e-mailu).
- Użytkownik nie otrzymuje sesji.
