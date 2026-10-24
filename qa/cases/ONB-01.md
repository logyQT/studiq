# ONB-01 — Nauczyciel bez organizacji → /setup

- id: ONB-01
- priority: P2 ważny
- module: ONB – Onboarding, organizacje i zaproszenia
- section: Nauczyciel – konfiguracja klasy
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany test.teacher01@example.com (bez organizacji).

## Steps

1. Po zalogowaniu obserwuj adres.
2. Sprawdź ekran „Witaj w StudiQ”.

## Expected result

- Automatyczne przekierowanie na /setup.
- Widoczne dwie opcje: „Dołącz do istniejącej organizacji” i „Utwórz własną klasę”.
- Próba wejścia na /edu przekierowuje z powrotem na /setup.
