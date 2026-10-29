# EDU-ASG-08 — Ocena odpowiedzi ucznia (per uczeń)

- id: EDU-ASG-08
- priority: P1 krytyczny
- module: EDU – Panel nauczyciela (/edu)
- section: Kartkówki (/edu/assignments)
- prereqs: none (self-contained tenant — see Seed)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Przesłana próba z pytaniem otwartym.

## Seed (QA-suite)

- Tenant: the case's own `content` tenant (`qa/tests/profiles/EDU-ASG-08.json`),
  seeded with `bun scripts/qa-tenant.ts EDU-ASG-08 --fresh` — one fresh run suffix
  per independent run. All ids come from
  `tenantKey('qa/cases/EDU-ASG-08.md', 'EDU-ASG-08#<run>', 'qa-shared')` +
  `tenantId(key, entity)`.
- Accounts: the tenant's `users.teacher` grades (the legacy
  `teacher-classroom@dev.local` / `TC`), and `users.student` submits the attempt the
  case calls `SC` (the legacy `student-classroom@dev.local`). No legacy/manual
  account or `pass` is used.
- Organization: `qa-edu-asg-08-<suffix>` with a manager (admin), the teacher and the
  student, plus the default group `G1` — the tenant-model equivalent of the case's
  „Classroom Group”. The student is a member of `G1`, so a quiz published to the
  group reaches them.
- Content (created by the spec, through the product API, per run): one question bank
  with two closed questions (one answered correctly, one incorrectly) and one open
  question, plus an assignment published to `G1`. The student starts the attempt,
  uploads a photo to the open question (`POST /api/v1/assignments/:id/upload-image`)
  and submits it — that is the case's „przesłana próba z pytaniem otwartym”. Nothing
  shared is read or written: no global admin setting, feature flag, plan, platform
  stat or singleton row, and no other tenant.
- Points bound (walk on the shared app, Polish UI): `assignment_questions.points`
  is the schema default `1` and no endpoint or screen changes it, so a question's
  maximum is 1 and the grading card reads „Punkty (0–1)”. The case's example „wpisz
  punkty (np. 2)” therefore lands outside the allowed range; the case's own rule
  („Punkty poza zakresem 0…max są odrzucone lub przycinane – zanotuj”) is what the
  suite asserts.
- UI note: the grading page shows „Wynik: X/Y”, the closed answers labelled
  „Poprawna” / „Niepoprawna” with the chosen and the correct answer **text**
  („Wybrana odpowiedź: …” / „Poprawna odpowiedź: …” — no answer UUID and no
  explanation in place of the answer), the open answer text and „Zobacz przesłane
  zdjęcie”. Above the maximum the inline „Punkty nie mogą przekraczać 1” appears and
  „Zapisz ocenę” is disabled; a negative value also leaves „Zapisz ocenę” disabled.

## Steps

1. Kliknij „Oceń” przy uczniu.
2. Dla pytania otwartego wpisz punkty (np. 2) i informację zwrotną; kliknij „Zapisz ocenę”.
3. Wpisz punkty większe niż maksymalne za pytanie oraz wartość ujemną.

## Expected result

- Strona „Oceń ucznia” pokazuje wynik „X/Y”, odpowiedzi ucznia (zamknięte: Poprawna/Niepoprawna), przesłane zdjęcie („Zobacz przesłane zdjęcie”).
- Zapis powoduje oznaczenie „(ocenione)” i aktualizację wyniku w tabeli wyników.
- Punkty poza zakresem 0…max są odrzucone lub przycinane – zanotuj.
- UWAGA UX: przy odpowiedzi zamkniętej widoczny jest „ID wybranej odpowiedzi” (identyfikator) zamiast jej treści oraz „Poprawna: <wyjaśnienie>” zamiast treści poprawnej odpowiedzi – zgłoś jako uwagę.

## Walk (QA-suite, shared app)

- Tabela wyników: kolumny Uczeń / E-mail / Wynik / Status / Ukończono / Akcje; wiersz
  próby pokazuje „1/3”, status „Przesłane” i link „Oceń”.
- Strona „Oceń ucznia”: „Wynik: 1/3”, pytanie zamknięte poprawne → „Poprawna”,
  „Wybrana odpowiedź: Odpowiedź poprawna”, „Poprawna odpowiedź: Odpowiedź poprawna”;
  pytanie zamknięte błędne → „Niepoprawna” z tą samą parą treści; pytanie otwarte →
  „Odpowiedź ucznia: …”, „Zobacz przesłane zdjęcie”, „Punkty (0–1)”,
  „Informacja zwrotna”, „Zapisz ocenę”.
- Punkty 2 → komunikat „Punkty nie mogą przekraczać 1” i nieaktywny „Zapisz ocenę”
  (żadnego żądania do API); punkty -1 → „Zapisz ocenę” nieaktywny.
- Punkty 1 + informacja zwrotna → „Wynik: 2/3 (ocenione)”, a po powrocie do wyników
  wiersz zmienia status na „Ocenione” i wynik na „2/3”. API odrzuca 2 i -1 jako 422 i
  nie nadpisuje zapisanej oceny.
- Uwaga UX z dokumentu jest już nieaktualna: identyfikator wybranej odpowiedzi nie
  jest renderowany, a „Poprawna odpowiedź: …” pokazuje treść odpowiedzi (nie
  wyjaśnienie). Zachowanie potwierdzone testem, nie zgłaszane jako defekt.
