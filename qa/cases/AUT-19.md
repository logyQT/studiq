# AUT-19 — API bez sesji i z niewłaściwą rolą

- id: AUT-19
- priority: P1 krytyczny
- module: AUT – Uwierzytelnianie i sesja
- section: Ochrona tras – macierz ról
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Okno bez sesji; potem sesja studenta.

## Steps

1. Bez logowania otwórz w przeglądarce /api/v1/flashcards/decks oraz /api/v1/teacher/quizzes.
2. Zaloguj się jako student1 i otwórz /api/v1/teacher/quizzes oraz /api/v1/organization/members.

## Expected result

- Bez sesji: JSON {success:false, error:…UNAUTHORIZED} z kodem 401.
- Student na /api/v1/teacher/*: kod 403 FORBIDDEN.
- Student na /api/v1/organization/members: brak danych członków (403 lub pusta lista – dane innych użytkowników nie mogą wyciec).
