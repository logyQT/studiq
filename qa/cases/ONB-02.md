# ONB-02 — Utworzenie klasy (bez zaproszeń)

- id: ONB-02
- priority: P1 krytyczny
- module: ONB – Onboarding, organizacje i zaproszenia
- section: Nauczyciel – konfiguracja klasy
- prereqs: ONB-01
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

ONB-01.

## Prerequisite context

### ONB-01 — Nauczyciel bez organizacji → /setup

_Warunek wstępny: Zalogowany test.teacher01@example.com (bez organizacji)._

1. Po zalogowaniu obserwuj adres.
2. Sprawdź ekran „Witaj w StudiQ”.

Expected:

- Automatyczne przekierowanie na /setup.
- Widoczne dwie opcje: „Dołącz do istniejącej organizacji” i „Utwórz własną klasę”.
- Próba wejścia na /edu przekierowuje z powrotem na /setup.

## Steps

1. Kliknij „Utwórz własną klasę”.
2. Wpisz nazwę „Moja Klasa” i kliknij „Utwórz klasę”.
3. Kliknij „Przejdź do panelu”.

## Expected result

- Podgląd po prawej pokazuje nazwę oraz „1 członków” z wpisem „Ty (Admin)”.
- Po utworzeniu ekran „Gotowe! Twoja klasa została utworzona.”
- Przejście do /edu; w pasku bocznym przełącznik organizacji pokazuje „Moja Klasa”.
