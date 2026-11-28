# STU-09 — Wygenerowanie i rozwiązanie quizu

- id: STU-09
- priority: P1 krytyczny
- module: STU – Panel studenta (/app)
- section: Quiz „Sprawdź się”
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany student-classroom@dev.local (10 pytań w 2 bankach).

## Seed (tenant model)

Automatyzacja nie używa ręcznego seeda (`student-classroom@dev.local`). Przypadek
dostaje własny tenant, zasiewany przez runner suite przed każdym niezależnym
przebiegiem:

```bash
bun scripts/qa-tenant.ts STU-09 --fresh
bunx playwright test -c __tests__/qa/playwright.qa.config.ts \
  __tests__/qa/STU/STU-09.spec.ts --workers=1
```

- Brak pliku profilu: domyślny profil `content` daje jedną organizację z
  managerem, edukatorem i studentem, na którym test się loguje, oraz domyślną
  grupę `G1`. Klucz tenanta:
  `tenantKey('qa/cases/STU-09.md', 'STU-09#<run>', 'qa-shared')`, wszystkie id z
  `tenantId` (albo zwrócone przez API tenanta); każdy niezależny przebieg dokłada
  świeży sufiks.
- Profil zasiewa wyłącznie graf, więc prerequisite „10 pytań w 2 bankach” buduje
  sam spec w tym samym tenancie: student tworzy 2 banki po 5 pytań przez
  `POST /api/v1/questions/banks` i `POST /api/v1/questions` — 4 WW, 3 P/F i 3
  otwarte, z artefaktami wymaganymi przez R16/R17 (wyjaśnienie dla WW i P/F,
  odpowiedź wzorcowa dla otwartych). Przy powtórzeniu na tym samym tenancie
  banki i pytania są używane ponownie, więc pula nie rośnie.
- Generator losuje 5 z 10 pytań, a oczekiwany wynik nazywa trzy typy odpowiedzi.
  Dlatego spec losuje quiz ponownie (z górnym ograniczeniem, każdy los to jedna
  z 10 dziennych prób planu free), aż próba zawiera co najmniej jedno pytanie
  każdego typu.
- Gdy tenant nie ma tematów, selektor „Przedmiot” się nie renderuje: domyślnym
  przedmiotem generatora są „Wszystkie przedmioty”, co potwierdza `config` próby
  (brak `topicIds`, trzy typy, `questionCount` = 5).
- Izolacja: test tworzy i czyta wyłącznie własną organizację, banki, pytania i
  próby quizu; nie dotyka innego tenanta, ustawień admina, flag funkcji, planów
  ani statystyk platformy.
- Spec: `__tests__/qa/STU/STU-09.spec.ts`, projekt
  `__tests__/qa/playwright.qa.config.ts`, `NEXT_LOCALE=pl` (kopie interfejsu w
  przypadku są polskie).

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
