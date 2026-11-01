# STU-41 — Licznik nieprzeczytanych zgłoszeń

- id: STU-41
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Zgłoszenia nieprawidłowości (student)
- prereqs: tenant `content` z edukatorem i studentem (`__tests__/qa/profiles/STU-41.json`)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Nauczyciel odpowiedział na zgłoszenie.

## Seed (tenant model)

Automatyzacja nie używa ręcznego seeda (`student1@dev.local`, `pass`, zgłoszenia
z organizacji WSB Merito). Przypadek dostaje własny tenant, zasiewany przez runner
suite przed każdym niezależnym przebiegiem:

```bash
bun scripts/qa-tenant.ts STU-41 --fresh
bunx playwright test -c qa/playwright.qa.config.ts \
  __tests__/qa/STU/STU-41.spec.ts --workers=1
```

- `__tests__/qa/profiles/STU-41.json` deklaruje profil `content`: jedna organizacja
  `qa-stu-41-<run>` z managerem (admin organizacji, nieużywany w teście), edukatorem
  i studentem, na którym test się loguje, oraz domyślna grupa `G1`. Klucz tenanta:
  `tenantKey('qa/cases/STU-41.md', 'STU-41#<run>', 'qa-shared')`, wszystkie id z
  `tenantId` lub z odpowiedzi API; każdy niezależny przebieg dokłada świeży sufiks,
  a `qa/.tenants/STU-41.json` czyta `loadTenant('STU-41')`.
- Profil zasiewa wyłącznie graf, więc prerequisite „Nauczyciel odpowiedział na
  zgłoszenie” buduje sam spec w tym tenancie: edukator posiada bank z dwoma pytaniami
  otwartymi (`POST /api/v1/questions/banks`, `POST /api/v1/questions`), student
  zgłasza oba pytania (`POST /api/v1/questions/<id>/reports`), a produkt adresuje
  zgłoszenia do autora pytania. Następnie edukator odpowiada w obu wątkach
  (`POST /api/v1/question-reports/<id>/messages`), co czyni je nieprzeczytanymi dla
  zgłaszającego.
- Licznik jest sprawdzany na dwóch wątkach, żeby widoczny był spadek 2 → 1, a nie
  tylko zniknięcie plakietki. Każde wykonanie najpierw czyści własne nieprzeczytane
  potwierdzenia obu uczestników, a potem tworzy nowe zgłoszenia, więc CI (jeden seed,
  retry na tym samym tenancie) nadal widzi dokładne 2 → 1 → 0.
- Spec: `__tests__/qa/STU/STU-41.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl` (kopie interfejsu w przypadku są polskie).
- Izolacja: test tworzy wyłącznie własny bank, pytania, zgłoszenia i odpowiedzi; nie
  dotyka innego tenanta, ustawień admina, flag funkcji, planów, statystyk platformy
  ani wierszy singletonowych.

## Steps

1. Zaloguj się jako zgłaszający student i obserwuj pozycję „Zgłoszenia” w menu bocznym.
2. Otwórz wątek.

## Expected result

- Przy „Zgłoszenia” widoczna plakietka z liczbą nieprzeczytanych.
- Po otwarciu wątku licznik maleje (zgłoszenie oznaczone jako przeczytane).

## Observations (walk 2026-10-29, shared app :3010, worker qa-env-6, pl)

- Menu boczne `/app` ma pozycję „Zgłoszenia” (`/app/reports`); przy dwóch
  odpowiedzianych zgłoszeniach plakietka to czerwony `rounded-full` z liczbą `2`
  zaraz za etykietą. `GET /api/v1/question-reports/unread-count` zwraca wtedy
  `{ count: 2 }` — plakietka pokazuje dokładnie wartość z API.
- Lista `/app/reports` pod nagłówkiem „Zgłoszenia” i opisem „Twoje zgłoszenia
  nieprawidłowości pytań i odpowiedzi wykładowców.” pokazuje oba wiersze z autorem
  „QA teacher”, statusem „Otwarte”, treścią pytania, datą i znacznikiem
  „Nieprzeczytane”.
- Wątek (`/app/reports/<id>`) pokazuje treść zgłoszenia i odpowiedź edukatora
  („STU-41 Odpowiedź nauczyciela …”) oraz pytanie w nagłówku. Otwarcie wątku wysyła
  `POST /api/v1/question-reports/<id>/read` i unieważnia zapytanie o licznik: plakietka
  zmienia się z `2` na `1`, a `unread-count` zwraca `1`.
- Po powrocie do listy otwarty wiersz nie ma już znacznika „Nieprzeczytane”, drugi
  wiersz nadal go ma; plakietka pozostaje `1`.
- Otwarcie drugiego wątku zdejmuje plakietkę całkowicie (element nie jest renderowany
  przy `0`), `unread-count` zwraca `0`, a lista nie pokazuje żadnego znacznika
  „Nieprzeczytane”.
- Zachowanie zgodne z oczekiwanym rezultatem przypadku — brak rozbieżności.
