# STU-02 — Checklista „Pierwsze kroki” (student)

- id: STU-02
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Pulpit (/app)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany test-student@dev.local (brak treści).

## Prereqs (tenant model)

The case's own tenant, seeded by `bun scripts/qa-tenant.ts STU-02 --fresh` (never
the legacy `test-student@dev.local` / `pass` account):

- key: `tenantKey('qa/cases/STU-02.md', 'STU-02#<run suffix>', 'qa-shared')`
- `__tests__/qa/profiles/STU-02.json` declares the default `content` profile: one
  organization with its manager/teacher and the `student` account the case logs
  in as. The student starts with **no content** (no deck, flashcard, question or
  quiz attempt), which is the case's „brak treści” prerequisite.
- the spec builds its deck, flashcard, question and quiz attempt inside that
  tenant through the student's own session; every id comes from `tenantKey` /
  `tenantId`, and no global row (admin settings, feature flags, plan catalogue,
  platform stats) is read or written.

## Steps

1. Na pulpicie sprawdź kartę „Pierwsze kroki”.
2. Wykonuj kolejno: utwórz talię, dodaj fiszkę, rozwiąż quiz (jeśli to możliwe), powtórz zaległe fiszki.
3. Po każdym kroku wróć na /app.

## Expected result

- Kroki: „Utwórz swoją pierwszą talię”, „Dodaj fiszki do talii”, „Rozwiąż swój pierwszy quiz”, „Powtórz zaległe fiszki”.
- Wykonane kroki są odznaczane/przekreślane zgodnie z faktycznym stanem danych.
- Po ukończeniu wszystkich kart można ukryć („Wykonałeś wszystkie kroki. Możesz ukryć tę kartę.”).
