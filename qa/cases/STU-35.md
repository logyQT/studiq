# STU-35 — Rozwiązanie kartkówki od startu do wysłania

- id: STU-35
- priority: P1 krytyczny
- module: STU – Panel studenta (/app)
- section: Kartkówki studenta (/app/assignments)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Oczekująca kartkówka z pytaniami MCQ, P/F i otwartym.

## Steps

1. Kliknij „Rozpocznij kartkówkę”.
2. Odpowiedz na pytania zamknięte i wpisz tekst w pytaniu otwartym („Wpisz swoją odpowiedź…”).
3. Dla otwartego dodaj zdjęcie przyciskiem „Prześlij zdjęcie”.
4. Użyj „Poprzednie”/„Następne”, na końcu „Wyślij”.

## Expected result

- Rozpoczęcie tworzy próbę (strona /app/assignments/<id>/take?attemptId=…).
- Odpowiedzi są zachowywane przy nawigacji; zdjęcie przesyła się („Przesyłanie…”) i pojawia się miniatura.
- Po „Wyślij” przejście do podsumowania lub listy z oznaczeniem „Ukończono”.
