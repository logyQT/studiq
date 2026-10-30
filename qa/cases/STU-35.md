# STU-35 — Rozwiązanie kartkówki od startu do wysłania

- id: STU-35
- priority: P1 krytyczny
- module: STU – Panel studenta (/app)
- section: Kartkówki studenta (/app/assignments)
- prereqs: none (self-contained tenant — see Prereqs)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Oczekująca kartkówka z pytaniami MCQ, P/F i otwartym.

## Steps

1. Kliknij „Rozpocznij kartkówkę”.
2. Odpowiedz na pytania zamknięte i wpisz tekst w pytaniu otwartym („Wpisz swoją odpowiedź…”).
3. Dla otwartego dodaj zdjęcie przyciskiem „Prześlij zdjęcie”.
4. Użyj „Poprzednie”/„Następne”, na końcu „Wyślij”.

## Expected result

- Rozpoczęcie tworzy próbę (strona /app/assignments/<id>/take?attemptId=…).
- Odpowiedzi są zachowywane przy nawigacji; zdjęcie przesyła się („Przesyłanie…”) i pojawia się miniatura.
- Po „Wyślij” przejście do podsumowania lub listy z oznaczeniem „Ukończono”.

## Prereqs (tenant model)

The case was written against the legacy manual seed (`student-classroom@dev.local` /
`teacher-classroom@dev.local`, group „Classroom Group”). The suite version uses the
case's own tenant and never the legacy accounts.

- Profile: `content` (`__tests__/qa/profiles/STU-35.json`) — one organization, one default
  group `G1`, and one account per account type: `manager` (org `admin`), `teacher` and
  the `student` who solves the quiz. All ids come from
  `tenantKey('qa/cases/STU-35.md', 'STU-35#<suffix>', 'qa-shared')` + `tenantId(key, entity)`.
- Seed: `bun scripts/qa-tenant.ts STU-35 --fresh` — a fresh run suffix per independent
  run, so every run gets its own org/users. The spec reads the ids through
  `loadTenant('STU-35')`.
- The prerequisite — an awaiting quiz with one multiple-choice, one true/false and one
  open question — is built by the spec through the product API in its own tenant, as
  the teacher, then published and targeted at the tenant student: one personal bank,
  the three questions, one assignment (`showResults: true` so the submitted result can
  be reviewed), `PUT …/targets` to the tenant student, `POST …/publish`.
- The bank and its questions are found-or-created, so a CI retry on the same seeded
  tenant reuses them instead of spending more of the educator's plan quota; every run
  creates its own assignment with a per-run title, because the student may start only
  one attempt per assignment.
- Nothing global is read or written — no admin setting, feature flag, plan, platform
  stat or singleton row — and no other tenant is touched.

## Observed during the suite walk (shared app 3010 / DB 54421, worker qa-env-4, pl)

- `/app/assignments` lists the quiz under „OCZEKUJĄCE (n)” with the title, „3 pytania ·
  3 punkty” and the description; clicking the card opens
  `/app/assignments/<id>` — „Pytania 3”, „Punkty 3”, description and the button
  **„Rozpocznij kartkówkę”**.
- „Rozpocznij kartkówkę” creates the attempt and redirects to
  `/app/assignments/<id>/take?attemptId=<uuid>` (no `deadline` parameter when the
  assignment has none). The breadcrumb reads „Rozwiązywanie kartkówki”, the header shows
  the position „1 / 3”, the question text, the options as radio rows and the buttons
  „Poprzednie” (disabled on the first question) / „Następne”.
- Question order and option order are shuffled (`shuffleQuestions` / `shuffleAnswers`
  default on), so the walk answers each question by its content, not by position.
- Clicking an option label selects its radio; going „Następne” and back with
  „Poprzednie” keeps the selected radio, and the open question keeps the typed text.
- The open question renders the textarea with placeholder „Wpisz swoją odpowiedź...”,
  the label „Prześlij zdjęcie (opcjonalnie)”, the button **„Prześlij zdjęcie”**, then
  the button label becomes **„Przesyłanie...”** while the upload request is in flight;
  on success the toast „Dodano zdjęcie: <nazwa>” appears and a 64×64 thumbnail with the
  file name is listed under `ul[aria-label="Dodane zdjęcia"]`.
- On the last question the button is **„Wyślij”** („Wysyłanie...” while submitting).
  Submitting navigates back to `/app/assignments/<id>`, which now shows
  **„Ukończono”** plus, with `showResults` on, „Wynik: 2/3” and
  „Zobacz podsumowanie”. The „Rozpocznij kartkówkę” action is gone (one attempt).
- „Zobacz podsumowanie” opens `/app/assignments/<id>/review?attemptId=<uuid>` with the
  score „2 / 3”, the selected options and the open answer as „Twoja odpowiedź: …” plus
  „Oczekuje na ocenę”.
- `/app/assignments` then lists the quiz under „UKOŃCZONE (n)” with „2/3” and
  „Ukończono: <data>”.
- API: `POST /api/v1/assignments/<id>/start` → 200 with the attempt id;
  `POST /api/v1/assignments/<id>/upload-image` → 200 with `imageUrl` under the
  `assignment-images` bucket; `POST /api/v1/quiz/<attemptId>` → 200 and
  `GET /api/v1/quiz/<attemptId>` (after submit, `show_results` on) returns the three
  answers with `selected_answer_id` / `text_answer`; `GET /api/v1/assignments` reports
  `attempts_used: 1` and the completed attempt with `score: 2`.
- The case's copy is matched: „Rozpocznij kartkówkę”, „Wpisz swoją odpowiedź...”,
  „Prześlij zdjęcie”, „Przesyłanie...”, „Poprzednie”, „Następne”, „Wyślij”,
  „Ukończono”.
