# STU-07 — Harmonogram powtórek zmienia się po ocenie

- id: STU-07
- priority: P1 krytyczny
- module: STU – Panel studenta (/app)
- section: Nauka fiszek – „Ucz się” (algorytm SM-2)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Sesja z kilkoma nowymi fiszkami.

## Seed (tenant model)

Automatyzacja nie używa ręcznego seeda; przypadek dostaje własny tenant, zasiewany przez
runner suite przed każdym niezależnym przebiegiem:

```bash
bun scripts/qa-tenant.ts STU-07 --fresh
bun run test:qa __tests__/qa/STU/STU-07.spec.ts --workers=1
```

- Profil `content` — domyślny profil seedera, więc przypadek nie ma osobnego
  `__tests__/qa/profiles/STU-07.json`: jedna organizacja z managerem, edukatorem i studentem,
  na którym test się loguje, oraz domyślna grupa `G1`. Klucz tenanta:
  `tenantKey('qa/cases/STU-07.md', 'STU-07#<run>', 'qa-shared')`, a każdy niezależny
  przebieg dokłada świeży sufiks.
- Profil zasiewa wyłącznie graf, więc prerequisite „Sesja z kilkoma nowymi fiszkami” buduje
  sam spec w tym samym tenancie: student tworzy przez API produktu talię
  `STU-07 harmonogram <run>` z dwiema fiszkami — A i B. Kolejka nowych kart to wtedy
  dokładnie te dwie fiszki, a nie zawartość innego przebiegu.
- Oceny: w sesji nowych kart przyciski mają warianty learning („Nie pamiętam (reset)” …
  „Łatwe (zakończ)”). A bierze „Łatwe” (confidence 4), B „Nie pamiętam” (confidence 1).
- „Pomyłki” to liczba błędnych odpowiedzi w `flashcard_practice`, a nie
  `flashcard_review_state.sm2_lapse_count` (ten dla B pozostaje 0; #809). Spec czyta ten
  sam wiersz przez `/api/v1/flashcards/<id>/practice/stats`, więc kolumna nie może rozjechać
  się z praktyką po cichu.
- Izolacja: spec czyta i zapisuje wyłącznie wiersze tego tenanta; nie dotyka ustawień
  admina, flag funkcji, planów, statystyk platformy ani wierszy singletonowych.

## Steps

1. Oceń fiszkę A jako „Łatwe”, fiszkę B jako „Nie pamiętam”.
2. Zakończ sesję i otwórz /app/stats/content (Treści) – tabela fiszek.
3. Porównaj kolumny Stan, Próby, Poprawność, EF, Interwał dla A i B.

## Expected result

- Fiszka A ma większy interwał / wyższy EF niż B; B ma wpisaną pomyłkę (kolumna „Pomyłki”/lapse) i jest w stanie nauki/poprawki.
- Pozycja „Następna powtórka:” w podglądzie fiszki odpowiada ocenie.
