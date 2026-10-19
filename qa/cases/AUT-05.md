# AUT-05 — Rejestracja na istniejący e-mail

- id: AUT-05
- priority: P2 ważny
- module: AUT – Uwierzytelnianie i sesja
- section: Rejestracja
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Konto student1@dev.local istnieje.

## Steps

1. Spróbuj zarejestrować się z e-mailem student1@dev.local.

## Expected result

- Brak utworzenia duplikatu. Komunikat (np. „Wystąpił konflikt. Zasób może już istnieć.” lub neutralny komunikat o wysłaniu linku – zanotuj faktyczny).
- Komunikat nie powinien ujawniać szczegółów technicznych ani stack trace.
