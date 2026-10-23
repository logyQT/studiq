# AUT-18 — Manager → trasy innych ról

- id: AUT-18
- priority: P1 krytyczny
- module: AUT – Uwierzytelnianie i sesja
- section: Ochrona tras – macierz ról
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany manager@dev.local.

## Steps

1. Otwórz /app, /edu, /edu/assignments, /setup.
2. Otwórz /setup/org.

## Expected result

- Trasy /app, /edu, /setup → przekierowanie do /manage.
- /setup/org jest dozwolone dla managera.
