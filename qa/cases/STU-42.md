# STU-42 — Statystyki – „Treści” (/app/stats/content)

- id: STU-42
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Statystyki studenta
- prereqs: STU-05
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Konto z historią nauki (po STU-05).

## Prerequisite context

### STU-05 — Sesja nauki – ocena fiszek (ścieżka pełna)

_Warunek wstępny: Przygotuj talię z kilkoma fiszkami (import CSV – plik fiszki_poprawne.csv z folderu Studiq_dane_testowe, 8 fiszek). Zalogowany student._

1. Na „Ucz się” kliknij „Rozpocznij naukę” / „Rozpocznij Przegląd”.
2. Dla pierwszej fiszki kliknij kartę, aby odsłonić odpowiedź.
3. Oceń kolejno fiszki przyciskami „Nie pamiętam”, „Trudne”, „Dobrze”, „Łatwe” (po jednej każdą).
4. Doprowadź sesję do końca.

Expected:

- Widoczne: licznik postępu, plakietka stanu fiszki (Nowa / Nauka / Przegląd / Poprawka), „Kliknij, aby odkryć odpowiedź”.
- Po odkryciu pojawiają się 4 przyciski ocen; każda ocena przechodzi do kolejnej fiszki.
- W trybie nauki (learning) etykiety przycisków: „Nie pamiętam (reset)”, „Trudne (zostań)”, „Dobrze (dalej)”, „Łatwe (zakończ)”.
- Na końcu ekran „Sesja zakończona!” z podsumowaniem: poprawne, czas, fiszek/min (w każdym trybie).
- Tryb „Limitowany” po osiągnięciu celu: przyciski „Przeglądaj ponownie” i „Powrót do przeglądu”.
- Tryb „Bez limitu” po wyczerpaniu kolejki: blok „Wszystko powtórzone!” z wyjaśnieniem „W tej sesji powtórzyłeś wszystkie fiszki z kolejki.”, tylko przycisk „Powrót do przeglądu” (kolejka nie jest uruchamiana ponownie).

## Steps

1. Otwórz /app/stats (przekierowanie) i przejrzyj zakładkę „Treści”.
2. Sortuj tabelę fiszek po: Data dodania, Próby, Poprawność, Łatwość.

## Expected result

- /app/stats przekierowuje do /app/stats/content.
- Karty: Wszystkie fiszki, Przećwiczone, Śr. poprawność, Śr. łatwość; podział na stany (Nowa, W nauce, Powtórka, Poprawa, Oporne).
- Tabela: Stan, Przód, Próby, Poprawność, EF, Interwał; wiersz rozwija szczegóły (Pytanie/Odpowiedź/Powtórzenia/Krok nauki/Pomyłki/Ostatnia powtórka).
- Sekcje „Najsłabsze talie” i „Najsłabsze tematy” (lub komunikaty „ćwicz dalej!”).
