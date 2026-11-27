# EDU-QZ-06 — Nauczyciel bez biblioteki testów (plan launch/base)

- id: EDU-QZ-06
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Quizy – biblioteka testów (/edu/quizzes)
- prereqs: none (self-contained tenant — see Seed)
- source: phase 5d entitlement gate (`quiz.templates`, ADR-0015 §7)

## Prerequisite (verbatim)

Nauczyciel na darmowym planie (organizacja `launch`, plan osobisty `free`) — bez entitlementu
`quiz.templates`.

## Seed (QA-suite)

- Tenant: the case's own `content` tenant on the free `launch` plan
  (`__tests__/qa/profiles/EDU-QZ-06.json` declares `"content"`; `launch` is the DB default — no
  `--plan` override), seeded with
  `bun scripts/qa-tenant.ts EDU-QZ-06 --fresh` — one fresh run suffix per independent run. All
  ids come from `tenantKey('qa/cases/EDU-QZ-06.md', 'EDU-QZ-06#<run>', 'qa-shared')` +
  `tenantId(key, entity)`; the spec reads them through `loadTenant('EDU-QZ-06')`.
- Account: the tenant's `users.teacher` (educator, org role `teacher`, personal plan `free`),
  logged in with the tenant org as the active org (`loginAs(page, tenant, 'teacher',
{ locale: 'pl' })`). The org's `launch` plan and the `free` personal plan both lack
  `quiz.templates`, so `GET /api/v1/me/entitlements` does not list it.
- Organization: `qa-edu-qz-06-<suffix>` with a manager, an educator and a student, plus the
  default group `G1`. Nothing shared is read or written: no admin setting, feature flag, plan,
  platform stat or singleton row, and no other tenant.

## Steps

1. Otwórz /edu/quizzes jako nauczyciel na planie launch.
2. Wywołaj `POST /api/v1/teacher/quizzes { "name": "Test" }` przez API.
3. Wejdź ręcznie na /edu/quizzes/new oraz na /edu/quizzes/<dowolny id>/edit (bez quizu na
   liście sam adres wystarcza — strona ma pokazać kartę planu, nie formularz).
4. Przejdź ścieżką jednofazową: na /edu/assignments/new (bez `?quizId=`) utwórz kartkówkę z
   co najmniej jednym pytaniem i opublikuj ją dla grupy G1.
5. Wywołaj `GET /api/v1/teacher/quizzes` przez API.
6. Otwórz /edu (panel główny nauczyciela) i obserwuj odpowiedzi sieciowe podczas ładowania.

## Expected result

- /edu/quizzes pokazuje kartę planu („Biblioteka testów” + przycisk „Zobacz plany”) zamiast
  listy quizów i bez przycisku „Nowy quiz”; nagłówek „Quizy” zostaje.
- `POST /api/v1/teacher/quizzes` → 403 `FORBIDDEN` (bramka entitlementu przed walidacją).
- /edu/quizzes/new i /edu/quizzes/<id>/edit pokazują kartę planu zamiast formularza; strona
  szczegółów quizu nadal pokazuje quiz, ale bez przycisków „Edytuj” i „Usuń”.
- Ścieżka jednofazowa działa: `POST /api/v1/teacher/assignments` → 201, dodanie pytania →
  200, publikacja → 200 (to nie jest biblioteka testów).
- `GET /api/v1/teacher/quizzes` → 200 (odczyt zostaje otwarty; pusta lista jest w porządku).
- /edu pokazuje kartę planu („Analizy i słabe punkty” + „Zobacz plany”) w miejsce treści
  obu kart „Wyniki grup” i „Ostatnia aktywność” (nagłówki kart zostają), a podczas
  ładowania panelu żadne zapytanie do `/api/v1/stats/teacher/groups` ani
  `/api/v1/stats/teacher/feed` nie odpowiada kodem 4xx (zapytania są wyłączone, gdy
  brak entitlementu `stats.insights`).
