# STU-03 — Menu boczne studenta

- id: STU-03
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Pulpit (/app)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany student1.

## Prereqs (tenant model)

The case's own tenant, seeded by `bun scripts/qa-tenant.ts STU-03 --fresh` (never
the legacy `student1@dev.local` / `pass` account):

- key: `tenantKey('qa/cases/STU-03.md', 'STU-03#<run suffix>', 'qa-shared')`
- `__tests__/qa/profiles/STU-03.json` declares the default `content` profile: one
  organization with the default group `G1`, its manager/teacher, and the student
  the case logs in as;
- the organization keeps its default `launch` plan, whose member role grants
  `flashcards`, `quiz` and `documents` but **not** `ai.chat` — the entitlement
  behind „Asystent Q”, and the reason the item is absent for the case's Base-plan
  S1. `/api/v1/features/me` is asserted, so the gate is tested, not the copy.

Every org/user/group id is `tenantId(key, entity)`; each independent run folds a
fresh suffix into the key, and nothing global is written.

## Steps

1. Sprawdź pozycje paska bocznego i kliknij każdą.
2. Zwiń pasek ikoną/Rail i rozwiń ponownie.

## Expected result

- Sekcje: Główne (Przegląd; „Asystent Q” tylko jeśli plan ma funkcję ai.chat), Nauka (Ucz się, Wkuwaj, Sprawdź się, Na żywo), Treści (Fiszki, Tematy, Pytania, Kartkówki, Zgłoszenia), Statystyki (Treści, Wyniki, Aktywność).
- Dla S1 (plan Base) pozycja „Asystent Q” NIE jest widoczna.
- Aktywna pozycja jest wyróżniona (również dla podstron, np. /app/flashcards/<id> podświetla „Fiszki”).
- Zwinięty pasek pokazuje same ikony z podpowiedziami.
