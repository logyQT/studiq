# STU-01 — Pulpit studenta – widok i statystyki

- id: STU-01
- priority: P1 krytyczny
- module: STU – Panel studenta (/app)
- section: Pulpit (/app)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany student1@dev.local.

## Seed (tenant model)

The dashboard is the signed-in student's own page, so the case uses its isolated tenant
instead of the legacy `student1@dev.local` account:

- tenant key: `tenantKey("qa/cases/STU-01.md", "STU-01", "qa-shared")`; each independent
  run adds a suffix — `tenantKey(..., "STU-01#<suffix>", ...)`
- seed: `bun scripts/qa-tenant.ts STU-01 --fresh` (profile `content`, `__tests__/qa/profiles/STU-01.json`)
  → org `qa-stu-01-<suffix>` with manager/teacher/student (`Seed4Test!`, profile
  `content`); the dashboard user is the tenant's `student` (`QA student`). The org, group
  and account ids stay deterministic through `tenantKey`/`tenantId`
- the seeded tenant starts with no content, so the spec builds its own deck and five cards
  through the product API, records their practice, and ages **only those** review-state
  rows into the past (service role, `qa/fixtures/qa-db.ts`) so the due-today plural can be
  exercised for 1, 2 and 5. No global row (settings, flags, plans, platform stats), other
  org or another worker's tenant is read or written

## Steps

1. Otwórz /app.
2. Sprawdź nagłówek z datą, powitanie i karty statystyk.
3. Kliknij „Kontynuuj przegląd”, wróć, kliknij „Utwórz talię”.

## Expected result

- Powitanie „Cześć, S1.” (pierwszy człon imienia) oraz zdanie „Masz N fiszek do powtórki dzisiaj” z poprawną odmianą liczebnika.
- Karty: Przećwiczone fiszki, Średni wynik (%), Ukończone testy, Skuteczność – liczby bez „NaN” / „undefined”.
- „Kontynuuj przegląd” → /app/study (przekierowanie do /app/study/learn); „Utwórz talię” → /app/flashcards.
- W trakcie ładowania karty pokazują „…”.

## Observations (walk, 2026-10-28, shared app :3010, QA worker qa-env-3)

Tenant `STU-01`, run `rmvsonit08b41` (`qa-stu-01-rmvsonit08b41`), student `QA student`.

- Powitanie: „Cześć, QA.” — pierwszy człon `user_metadata.name` („QA student”), nie pełne
  imię i nazwisko. Nad powitaniem widoczny nagłówek daty po polsku (CSS `uppercase`, np.
  „ŚRODA, 28 PAŹDZIERNIKA”).
- Stan pustego konta: „Masz 0 fiszek do powtórki dzisiaj.”; karty 0 / — / 0 / 0%. Po
  dodaniu pięciu własnych fiszek i zaliczeniu powtórek: 1 → „Masz 1 fiszkę…”, 2 → „Masz 2
  fiszki…”, 5 → „Masz 5 fiszek…”; „Przećwiczone fiszki” 5, „Skuteczność” 100%.
- „Kontynuuj przegląd” (przycisk `router.push('/app/study')`) ląduje na
  `/app/study/learn`; „Utwórz talię” → `/app/flashcards`. Oba przyciski występują raz.
- Odstępstwa od treści przypadku (P3, prezentacja/tekst — nie usterka działania): tytuł
  karty to „Średni wynik” bez „(%)”; przy braku ukończonych testów wartość to „—” (decyzja
  #619), nie liczba; stan ładowania to pulsujący szkielet karty (placeholder), nie dosłowny
  znak „…”. Test sprawdza intencję: placeholder podczas ładowania i brak „NaN”/„undefined”.
- Brak surowych kluczy tłumaczeń ani tekstów „NaN”/„undefined” na `/app`.
