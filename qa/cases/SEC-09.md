# SEC-09 — Kartkówki i wyniki cudzych uczniów

- id: SEC-09
- priority: P1 krytyczny
- module: SEC – Autoryzacja i izolacja danych
- section: Uprawnienia ról
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

student1 i student-classroom; opublikowana kartkówka w Classroom.

## Steps

1. Jako student1: GET /api/v1/assignments/<id kartkówki Classroom>.
2. GET /api/v1/quiz/<attemptId SC>.
3. Jako teacher1 (inna organizacja): GET /api/v1/teacher/assignments/<id>/results.

## Expected result

- Brak dostępu do cudzej kartkówki, próby i wyników (403/404).
