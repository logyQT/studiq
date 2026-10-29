# STU-37 — Podsumowanie wyników kartkówki

- id: STU-37
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Kartkówki studenta (/app/assignments)
- prereqs: tenant `content` z edukatorem i studentem (`__tests__/qa/profiles/STU-37.json`)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Ukończona i oceniona kartkówka; w ustawieniach „Pokaż wyniki” włączone/wyłączone.

## Seed (tenant model)

Automatyzacja nie używa ręcznego seeda (`student-classroom@dev.local`, `pass`,
kartkówki „Classroom Group”). Przypadek dostaje własny tenant, zasiewany przez runner
suite przed każdym niezależnym przebiegiem:

```bash
bun scripts/qa-tenant.ts STU-37 --fresh
bunx playwright test -c qa/playwright.qa.config.ts \
  __tests__/qa/STU/STU-37.spec.ts --workers=1
```

- `__tests__/qa/profiles/STU-37.json` deklaruje profil `content`: jedna organizacja
  `qa-stu-37-<run>` z managerem (admin organizacji, nieużywany w teście), edukatorem
  i studentem, na którym test się loguje, oraz domyślna grupa `G1`. Klucz tenanta:
  `tenantKey('qa/cases/STU-37.md', 'STU-37#<run>', 'qa-shared')`, wszystkie id z
  `tenantId` (albo zwrócone przez API tenanta); każdy niezależny przebieg dokłada
  świeży sufiks, a `qa/.tenants/STU-37.json` czyta `loadTenant('STU-37')`.
- Profil zasiewa wyłącznie graf, więc prerequisite „Ukończona i oceniona kartkówka”
  buduje sam spec w tym tenancie: edukator tworzy bank z dwoma pytaniami WW i jednym
  otwartym, a następnie dwie opublikowane kartkówki dla studenta — jedną z „Pokaż
  wyniki” włączonym i jedną z wyłączonym (`POST /api/v1/teacher/assignments`,
  `.../questions`, `PUT .../targets`, `.../publish`). Student odpowiada na obie
  (`POST /api/v1/assignments/<id>/start`, `POST /api/v1/quiz/<attemptId>`), a edukator
  ocenia odpowiedź otwartą z informacją zwrotną (`PUT
/api/v1/teacher/assignments/<id>/results/<studentId>`).
- Każde wykonanie nadaje treściom i tytułom własny tag (`<run>-<timestamp>`), a
  `maxAttempts: 1` trzyma kartkówki w sekcji „Ukończone”; CI zasiewa tenant **raz**
  i używa go ponownie w każdym retry, więc ponowny przebieg dokłada tylko nowe
  kartkówki, których asercje nie dotyczą.
- Spec: `__tests__/qa/STU/STU-37.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl` (kopie interfejsu w przypadku są polskie).
- Izolacja: test tworzy wyłącznie własny bank, pytania, kartkówki i próby; nie dotyka
  innego tenanta, ustawień admina, flag funkcji, planów, statystyk platformy ani
  wierszy singletonowych.

## Steps

1. Otwórz ukończoną kartkówkę i kliknij „Zobacz podsumowanie”.
2. Powtórz dla kartkówki z wyłączonym „Pokaż wyniki”.

## Expected result

- Przy włączonym „Pokaż wyniki”: wynik „Wynik: X/Y”, odpowiedzi, informacja zwrotna nauczyciela („Informacja zwrotna: …”).
- Przy wyłączonym: „Podsumowanie niedostępne”.

## Observations (walk 2026-10-29, shared app :3010, worker qa-env-6, pl)

- Lista „Moje kartkówki” (`/app/assignments`) grupuje ukończone kartkówki w sekcji
  „UKOŃCZONE (n)”. Karta z włączonym „Pokaż wyniki” pokazuje wynik `2/3` i datę
  „Ukończono: <data>”; karta z wyłączonym pokazuje w prawym górnym rogu
  „Podsumowanie niedostępne” (bez wyniku).
- Szczegóły kartkówki (`/app/assignments/<id>`) mają nagłówek z tytułem, karty
  „Pytania” i „Punkty”, a dla ukończonej próby kartę „Ukończono” z „Wynik: 2/3”
  i przyciskiem-linkiem „Zobacz podsumowanie”. Przy wyłączonym „Pokaż wyniki” karta
  pokazuje wyłącznie „Podsumowanie niedostępne” — nie ma wyniku ani linku do
  podsumowania (metadana ukończenia zostaje).
- „Zobacz podsumowanie” prowadzi do `/app/assignments/<id>/review?attemptId=<id>`.
  Nagłówek to sam wynik `2 / 3`, pod nim `67%`; każda odpowiedź WW jest renderowana
  z zaznaczoną poprawną opcją, a błędnie wybrana opcja jest przekreślona. Pytanie
  otwarte pokazuje „Twoja odpowiedź: …”, „Przyznane punkty: 1” oraz
  „Informacja zwrotna: <treść>”.
- Bezpośrednie wejście na `/app/assignments/<id>/review` dla kartkówki z wyłączonym
  „Pokaż wyniki” renderuje tylko „Podsumowanie niedostępne” (bez nagłówka z wynikiem).
  API również nie wycieka wyniku: `GET /api/v1/quiz/<attemptId>` odpowiada 403,
  a `score` w `GET /api/v1/assignments/<id>` jest `null`; submit takiej kartkówki
  zwraca `score: null`.
- Zachowanie zgodne z oczekiwanym rezultatem przypadku — brak rozbieżności.
