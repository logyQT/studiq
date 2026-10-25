# STU-05 — Sesja nauki – ocena fiszek (ścieżka pełna)

- id: STU-05
- priority: P1 krytyczny
- module: STU – Panel studenta (/app)
- section: Nauka fiszek – „Ucz się” (algorytm SM-2)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Przygotuj talię z kilkoma fiszkami (import CSV – plik fiszki_poprawne.csv z folderu Studiq_dane_testowe, 8 fiszek). Zalogowany student.

## Steps

1. Na „Ucz się” kliknij „Rozpocznij naukę” / „Rozpocznij Przegląd”.
2. Dla pierwszej fiszki kliknij kartę, aby odsłonić odpowiedź.
3. Oceń kolejno fiszki przyciskami „Nie pamiętam”, „Trudne”, „Dobrze”, „Łatwe” (po jednej każdą).
4. Doprowadź sesję do końca.

## Expected result

- Widoczne: licznik postępu, plakietka stanu fiszki (Nowa / Nauka / Przegląd / Poprawka), „Kliknij, aby odkryć odpowiedź”.
- Po odkryciu pojawiają się 4 przyciski ocen; każda ocena przechodzi do kolejnej fiszki.
- W trybie nauki (learning) etykiety przycisków: „Nie pamiętam (reset)”, „Trudne (zostań)”, „Dobrze (dalej)”, „Łatwe (zakończ)”.
- Na końcu ekran „Sesja zakończona!” z podsumowaniem: poprawne, czas, fiszek/min (w każdym trybie).
- Tryb „Limitowany” po osiągnięciu celu: przyciski „Przeglądaj ponownie” i „Powrót do przeglądu”.
- Tryb „Bez limitu” po wyczerpaniu kolejki: blok „Wszystko powtórzone!” z wyjaśnieniem „W tej sesji powtórzyłeś wszystkie fiszki z kolejki.”, tylko przycisk „Powrót do przeglądu” (kolejka nie jest uruchamiana ponownie).
