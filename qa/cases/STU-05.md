# STU-05 — Sesja nauki – ocena fiszek (ścieżka pełna)

- id: STU-05
- priority: P1 krytyczny
- module: STU – Panel studenta (/app)
- section: Nauka fiszek – „Ucz się” (algorytm SM-2)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Przygotuj talię z kilkoma fiszkami (import CSV – plik fiszki_poprawne.csv z folderu Studiq_dane_testowe, 8 fiszek). Zalogowany student.

## Seed (tenant model)

Automatyzacja nie używa ręcznego seeda (`student1@dev.local`, `pass`, import CSV
`fiszki_poprawne.csv`). Przypadek dostaje własny tenant, zasiewany przez runner suite
przed każdym niezależnym przebiegiem:

```bash
bun scripts/qa-tenant.ts STU-05 --fresh
bunx playwright test -c qa/playwright.qa.config.ts \
  __tests__/qa/STU/STU-05.spec.ts --workers=1
```

- `__tests__/qa/profiles/STU-05.json` deklaruje domyślny profil `content`: jedna organizacja
  z managerem (admin organizacji, nieużywany w teście), edukatorem i studentem, na
  którym test się loguje, oraz domyślna grupa `G1`. Klucz tenanta:
  `tenantKey('qa/cases/STU-05.md', 'STU-05#<run>', 'qa-shared')`, wszystkie id z
  `tenantId` (albo zwrócone przez API tenanta); każdy niezależny przebieg dokłada świeży
  sufiks.
- Profil zasiewa wyłącznie graf, więc prerequisite „talia z 8 fiszkami” buduje sam spec
  w tym samym tenancie: student tworzy talię `STU-05 <run>` i 8 fiszek
  (`Pytanie N <run>` / `Odpowiedz N <run>`) przez `POST /api/v1/flashcards/decks` i
  `POST /api/v1/flashcards` (odpowiednik importu CSV z opisu przypadku).
- CI zasiewa tenant **raz** i używa go ponownie w każdym retry; dlatego test najpierw
  usuwa własną talię `STU-05 …` (kaskadowo karty, ich `flashcard_review_state` i
  `flashcard_practice`) przez API produktu i zeruje własny dzienny licznik nowych kart
  studenta (limit 20/dzień wyczerpałby się w trzecim przebiegu). To wyłącznie wiersze
  tego tenanta.
- Faza „Limitowany" potrzebuje fiszek do powtórki, a harmonogram nie ma akcji „udostępnij
  teraz": spec postarza **własne** wiersze `flashcard_review_state` z pierwszej sesji (po
  id zwróconych przez API) — ten sam wyjątek „czas" co przy wygasających zaproszeniach
  (`qa/fixtures/qa-db.ts`). Żaden inny wiersz nie jest ruszany.
- Spec: `__tests__/qa/STU/STU-05.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl` (kopie interfejsu w przypadku są polskie).
- Izolacja: test tworzy i sprząta wyłącznie własną organizację, talię i fiszki; nie
  dotyka innego tenanta, ustawień admina, flag funkcji, planów, statystyk platformy ani
  wierszy singletonowych.

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

## Observations (walk 2026-10-29, shared app :3010, worker qa-env-8)

- Pierwsza sesja (8 nowych fiszek, tryb „Bez limitu”): plakietka „Nowa”, licznik
  „0/0 poprawnych”, podpowiedź „Kliknij, aby odkryć odpowiedź” i etykiety trybu nauki
  („Nie pamiętam (reset)”, „Trudne (zostań)”, „Dobrze (dalej)”, „Łatwe (zakończ)”) są
  widoczne od razu; przyciski ocen są przygaszone do momentu odkrycia karty.
- Każda ocena przechodzi do kolejnej fiszki i podnosi licznik: Nie pamiętam → „0/1”,
  Trudne → „0/2”, Dobrze → „1/3”, Łatwe → „2/4”.
- Po wyczerpaniu kolejki (8/8) ekran „Sesja zakończona!” pokazuje „6 z 8 poprawnych”,
  procent, blok „Poprawne 6/8”, „Czas” (m:ss) i „Fiszek / min”; dodatkowo blok
  „Wszystko powtórzone!” z tekstem „W tej sesji powtórzyłeś wszystkie fiszki z kolejki.”
  i **tylko** przycisk „Powrót do przeglądu” — „Przeglądaj ponownie” nie jest renderowany.
- Tryb „Limitowany” (cel 3 poprawne) po trzeciej ocenie „Dobrze (dalej)” kończy sesję:
  „Sesja zakończona!”, „3 z 3 poprawnych”, „Poprawne 3/3” oraz oba przyciski
  „Przeglądaj ponownie” i „Powrót do przeglądu”; bloku „Wszystko powtórzone!” nie ma.
- Fiszki z pierwszej sesji w stanie nauki pokazują w trybie limitowanym plakietkę
  „Nauka”, licznik „0/0 poprawnych” i plakietkę celu „0/3 zapamiętanych”.
- Karta w stanie „Przegląd” (np. po ocenie „Łatwe”) nie renderuje plakietki stanu — widok
  pomija ją dla stanu domyślnego (`card_state_review`); w ścieżce przypadku widoczne są
  plakietki „Nowa” (sesja nowych kart) i „Nauka” (sesja powtórkowa).
