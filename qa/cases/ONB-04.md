# ONB-04 — Manager bez organizacji → /setup/org

- id: ONB-04
- priority: P2 ważny
- module: ONB – Onboarding, organizacje i zaproszenia
- section: Manager – konfiguracja organizacji
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany test.manager01@example.com.

## Steps

1. Po zalogowaniu obserwuj adres.
2. Wpisz nazwę organizacji „Test Uczelnia” i kliknij „Utwórz organizację”.

## Expected result

- Przekierowanie na /setup/org z formularzem „Skonfiguruj swoją organizację”.
- Przycisk „Utwórz organizację” nieaktywny przy pustej nazwie.
- Po utworzeniu przejście do /manage; w przełączniku organizacji „Test Uczelnia”, rola „Admin”.
- W bazie istnieją role systemowe organizacji: member, teacher, admin.
