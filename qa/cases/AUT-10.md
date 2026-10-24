# AUT-10 — Logowanie – próba przekierowania na zewnętrzny adres (open redirect)

- id: AUT-10
- priority: P2 ważny
- module: AUT – Uwierzytelnianie i sesja
- section: Logowanie
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Otwórz /login?next=https://example.com i zaloguj się.
2. Otwórz /login?next=//example.com i zaloguj się.

## Expected result

- Użytkownik NIE jest przekierowywany na zewnętrzną domenę – trafia na swój panel (lub ścieżkę lokalną).
