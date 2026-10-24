# STU-09 — Wygenerowanie i rozwiązanie quizu

- id: STU-09
- priority: P1 krytyczny
- module: STU – Panel studenta (/app)
- section: Quiz „Sprawdź się”
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany student-classroom@dev.local (10 pytań w 2 bankach).

## Steps

1. Otwórz /app/study/quiz → zakładka „Quiz”.
2. Kliknij „Nowy quiz”. Wybierz przedmiot „Wszystkie przedmioty”, typy: WW, P/F, Otwarte; liczba pytań: 5.
3. Kliknij „Generuj quiz”.
4. Odpowiedz na wszystkie pytania, używając „Poprzednie” / „Następne”.
5. Kliknij „Zakończ test”.

## Expected result

- Quiz otwiera się w /app/study/session/quiz/<id>; pasek „Pytanie X z 5”.
- Pytania WW mają radio-odpowiedzi, P/F „Prawda/Fałsz”, otwarte – pole tekstowe.
- Po zakończeniu ekran „Test ukończony!” z wynikiem „N z M poprawnych”.
- Wynik pojawia się w „Ostatnie quizy”/Historii.
