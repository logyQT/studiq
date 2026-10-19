# AUT-15 — Niezalogowany → trasy chronione

- id: AUT-15
- priority: P1 krytyczny
- module: AUT – Uwierzytelnianie i sesja
- section: Ochrona tras – macierz ról
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Otwórz kolejno: /app, /edu, /manage, /setup, /setup/org, /app/flashcards, /edu/assignments, /manage/members.

## Expected result

- Każda trasa przekierowuje na /login?next=<ścieżka>.
