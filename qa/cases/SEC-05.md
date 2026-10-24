# SEC-05 — Student nie wykona akcji nauczyciela przez API

- id: SEC-05
- priority: P1 krytyczny
- module: SEC – Autoryzacja i izolacja danych
- section: Uprawnienia ról
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

student1.

## Steps

1. POST /api/v1/teacher/quizzes {name:"x"}.
2. POST /api/v1/teacher/assignments {...}.
3. GET /api/v1/stats/teacher.

## Expected result

- Każde wywołanie: 403 FORBIDDEN (reguły tras) – brak utworzenia zasobów.
