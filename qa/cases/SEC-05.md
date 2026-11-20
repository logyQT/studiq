# SEC-05 — Student nie wykona akcji nauczyciela przez API

- id: SEC-05
- priority: P1 krytyczny
- module: SEC – Autoryzacja i izolacja danych
- section: Uprawnienia ról
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

student1.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont ręcznego seeda (`student1@dev.local`, hasło `pass`). Przypadek
dostaje własny tenant, seedowany przez wspólne helpery e2e (`__tests__/helpers/tenant-seed.ts`)
w `test.beforeAll`, więc każde niezależne uruchomienie startuje od świeżych kont i organizacji:

- Klucz tenanta: `SEC-05.md::SEC-05 student cannot call teacher endpoints::qa-shared::<run>` —
  `tenantKey('qa/cases/SEC-05.md', 'SEC-05 student cannot call teacher endpoints', 'qa-shared')`
  - świeży sufiks przebiegu; identyfikatory organizacji, grupy, kont i członkostw to
    `tenantId(key, entity)` (ten sam schemat co fixture'y e2e, bez losowych UUID).
- Organizacja `qa-sec-05-<suffix>` z domyślną grupą `G1` — odpowiednik „WSB Merito” z ręcznego
  seeda: `student1` jest studentem **wewnątrz organizacji**, nie kontem bez organizacji.
  Dzięki temu odrzucenie 403 nie może być skutkiem braku kontekstu organizacji.
- Konta (hasło `Seed4Test!`):
  - `student` (`qa+<hash>+student@test.local`) — podmiot przypadku, typ konta `student`,
    rola organizacyjna `member`, członek `G1`;
  - `teacher` (`qa+<hash>+teacher@test.local`) — kontrola pozytywna, typ konta `educator`,
    rola organizacyjna `teacher`;
  - `manager` (`qa+<hash>+manager@test.local`) — admin organizacji (spójny graf tenanta).
- Spec: `__tests__/qa/SEC/SEC-05.spec.ts`, projekt `__tests__/qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl`.
- Izolacja: test czyta i próbuje zapisywać wyłącznie w granicach własnego tenanta; nie dotyka
  flag funkcji, katalogu planów, statystyk platformy, ustawień admina ani wierszy
  singletonowych. Jedyne zapisy to dwie kontrolne pozycje nauczyciela w jego własnej
  organizacji.

## Steps

1. POST /api/v1/teacher/quizzes {name:"x"}.
2. POST /api/v1/teacher/assignments {...}.
3. GET /api/v1/stats/teacher.
4. GET /api/v1/teacher/quizzes oraz GET /api/v1/teacher/assignments.

## Expected result

- Od fazy 2b-6 bramką nie jest typ konta, lecz klucz katalogu uprawnień:
  - POST /api/v1/teacher/quizzes → **201** (rola `member` ma `quiz.create` w
    zakresie `own`; utworzony quiz należy do studenta; spec usuwa go potem jako
    właściciel);
  - POST /api/v1/teacher/assignments → **403 FORBIDDEN** (rola `member` nie ma
    żadnego klucza `assignment.*`; nieprawidłowe ciało również 403, nigdy 422);
  - GET /api/v1/teacher/assignments → **403 FORBIDDEN**;
  - GET /api/v1/stats/teacher → **200** z własnymi statystykami studenta
    (`stats.read` w zakresie `own`) – bez danych nauczyciela;
  - GET /api/v1/teacher/quizzes → **200** z listą quizów własnych studenta
    (pustą) – bez quizów nauczyciela;
  - brak utworzenia zasobów staffowych: organizacja nie ma żadnych wierszy
    `teacher_assignments`, a żaden wiersz tej tabeli nie ma `created_by` studenta.

## Observed during the suite walk (qa-env-3, shared app 3010 / DB 54421; the walk predates phase 2b-6 — the (2b-6) bullets are expected under 2b-6, not observed)

- **2026-11-20 (2b-6):** the walk above predates the slice, so no (2b-6) bullet below is an
  observation of it; each is the **expected** 2b-6 behaviour, pinned by
  `__tests__/qa/SEC/SEC-05.spec.ts` and
  `__tests__/integration/content-route-permission-api.test.ts`.
- Konto `student` ma aktywną własną organizację (`GET /api/v1/me/orgs` →
  `orgRoleName: "member"`, `isActive: true`, `GET /api/v1/auth/me` → `account_type: "student"`),
  więc nie jest to „zalogowany bez organizacji”.
- Krok 1 (2b-6, expected): `POST /api/v1/teacher/quizzes {name:"x"}` → **201** — rola `member` ma
  `quiz.create` w zakresie `own`, więc własnościowe utworzenie quizu jest dozwolone; wiersz
  ma `created_by` studenta. Spec usuwa go następnie jako właściciel (DELETE → 200).
- Krok 2: `POST /api/v1/teacher/assignments {title:"x", …}` → **403 `FORBIDDEN`**, nagłówek
  `x-error-code: FORBIDDEN`, treść dokładnie `{"success":false,"error":"FORBIDDEN"}` — bez
  `data`. Ten sam request z niepoprawnym ciałem (`{}`) również zwraca **403**, a nie 422:
  bramka klucza działa przed walidacją wejścia (rola `member` nie ma `assignment.*`).
- Krok 3 (2b-6, expected): `GET /api/v1/stats/teacher` → **200** z własnymi statystykami studenta
  (`stats.read` w zakresie `own`, `totalQuestions` = 0) — bez jakichkolwiek danych nauczyciela.
- „Brak utworzenia zasobów staffowych” potwierdzone w bazie klientem service-role: po próbach
  organizacja ma **0** wierszy w `teacher_assignments`, a żaden wiersz tej tabeli nie ma
  `created_by` studenta; quiz studenta został usunięty, więc `quizzes` też wraca do **0**.
- Ścieżki sąsiednie (2b-6, expected): `GET /api/v1/teacher/quizzes` → **200** z listą własnych quizów
  studenta (pustą), `GET /api/v1/teacher/assignments` → **403** (brak `assignment.read`).
- Kontrola pozytywna (ten sam tenant, ta sama aktywna organizacja): nauczyciel tworzy quiz i
  kartkówkę (**201**) oraz czyta statystyki nauczyciela (**200**) — odrzucenie studenta to
  granica uprawnień, nie zepsuta trasa ani fixture. Student nadal korzysta z własnego panelu:
  `/app` się ładuje, `GET /api/v1/stats/student` → **200**.
- Produkt zachowuje się zgodnie z oczekiwanym rezultatem przypadku — brak odstępstw
  funkcjonalnych do zgłoszenia.
