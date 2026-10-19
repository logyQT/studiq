# STU-10 — Quiz – wznowienie niedokończonego

- id: STU-10
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Quiz „Sprawdź się”
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Rozpoczęty quiz (nie zakończony).

## Steps

1. Opuść quiz (np. wróć na /app/study/quiz).
2. Sprawdź banner „Quiz w trakcie”.
3. Kliknij „Kontynuuj”.
4. Powtórz i kliknij „Anuluj” przy trwającym quizie.

## Expected result

- Banner „Masz niedokończony quiz. Kontynuuj lub anuluj go.” z przyciskami „Kontynuuj” i „Anuluj”.
- „Kontynuuj” wraca do tego samego quizu z zachowanymi odpowiedziami.
- ZNANE OGRANICZENIE: „Anuluj” pokazuje komunikat „Anulowanie quizów będzie dostępne wkrótce” (funkcja niezaimplementowana) – potwierdź brak awarii.
