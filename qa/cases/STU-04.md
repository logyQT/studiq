# STU-04 — Strona „Ucz się” – stan z fiszkami do powtórki

- id: STU-04
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Nauka fiszek – „Ucz się” (algorytm SM-2)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany student1; w O1G1T1 i O1S1 są fiszki.

## Steps

1. Otwórz /app/study (lub „Ucz się”).
2. Sprawdź licznik „fiszek oczekuje na powtórkę” / „nowych kart dostępnych do nauki”.
3. Sprawdź przełącznik trybu „Bez limitu / Limitowany”.

## Expected result

- Karta „Przegląd” z liczbą zaległych albo „Nowe karty” z paskiem dziennego limitu (domyślnie 20 nowych kart dziennie – „X z 20 nowych kart dzisiaj”).
- Opis trybu zmienia się: „Kontynuuj aż wszystkie fiszki zostaną przejrane” vs „Przeglądaj aż osiągniesz docelową liczbę poprawnych”.
- W trybie Limitowany pojawia się suwak „Cel: N poprawnych”.
