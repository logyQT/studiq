# STU-28 — Operacje zbiorcze na fiszkach

- id: STU-28
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Fiszki w talii (/app/flashcards/<id>)
- prereqs: none (self-contained tenant — see Seed)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Talia z ≥ 5 fiszkami; druga talia B.

## Seed (QA-suite)

- Tenant: `bun scripts/qa-tenant.ts STU-28 --fresh`
  (`__tests__/qa/profiles/STU-28.json` → `content`), key
  `tenantKey('qa/cases/STU-28.md', 'STU-28#<run>', 'qa-shared')`; the spec signs in as
  the tenant's `users.student` (`loginAs(page, tenant, 'student', { locale: 'pl' })`).
  No legacy/manual account (`student1@dev.local`, `pass`) is used.
- Content is built through the product API inside this tenant only, so nothing is
  shared with another case: „Talia A STU-28” (talia źródłowa) with 5 fiszki
  „Fiszka A1…A5”, „Talia B STU-28” (pusta talia docelowa) and the topic
  „Temat STU-28”. A retry reuses the CI-seeded tenant, so the spec first deletes
  this student's decks/topics in its own organization.
- UI note (walk on the shared app, 2026-10-29): zaznaczanie startuje z menu karty
  fiszki („…” → „Wybierz Fiszki”) — nie ma osobnego przycisku w pasku narzędzi.
  Akcje zbiorcze w dolnym pasku to „Kopiuj”, „Eksportuj”, „Tematy”, „Przenieś”,
  „Usuń”; po zaznaczeniu widać „Zaznacz Wszystkie”/„Odznacz Wszystkie” i licznik
  „Wybrano N”.

## Steps

1. Otwórz talię A, na karcie fiszki wybierz z menu „…” pozycję „Wybierz Fiszki”,
   zaznacz 3 fiszki; sprawdź „Zaznacz Wszystkie” (a następnie „Odznacz Wszystkie”
   i ponowny wybór trzech).
2. Wykonaj kolejno: Tematy (Ustaw), Kopiuj (do talii B), Przenieś (do B). Po przeniesieniu
   zaznacz dwie pozostałe fiszki w talii A, wybierz „Usuń” i potwierdź usunięcie.

## Expected result

- Dla każdej akcji toast: „Zaktualizowano tematy dla 3 fiszek”, „Skopiowano 3 fiszki”,
  „Fiszki przeniesiono do nowej talii”, „Usunięto 2 fiszki”.
- Usunięcie: „Usunąć 2 fiszki?” – „Te fiszki zostaną trwale usunięte. Tej operacji
  nie można cofnąć.” i usunięcie po potwierdzeniu („Anuluj” nic nie zmienia).
- Licznik w talii źródłowej i docelowej aktualizuje się (5 → 2 → 0 w A; 0 → 3 → 6 w B).
