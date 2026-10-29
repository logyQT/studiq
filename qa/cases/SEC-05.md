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
- Spec: `__tests__/qa/SEC/SEC-05.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl`.
- Izolacja: test czyta i próbuje zapisywać wyłącznie w granicach własnego tenanta; nie dotyka
  flag funkcji, katalogu planów, statystyk platformy, ustawień admina ani wierszy
  singletonowych. Jedyne zapisy to dwie kontrolne pozycje nauczyciela w jego własnej
  organizacji.

## Steps

1. POST /api/v1/teacher/quizzes {name:"x"}.
2. POST /api/v1/teacher/assignments {...}.
3. GET /api/v1/stats/teacher.

## Expected result

- Każde wywołanie: 403 FORBIDDEN (reguły tras) – brak utworzenia zasobów.

## Observed during the suite walk (qa-env-3, shared app 3010 / DB 54421)

- Konto `student` ma aktywną własną organizację (`GET /api/v1/me/orgs` →
  `orgRoleName: "member"`, `isActive: true`, `GET /api/v1/auth/me` → `account_type: "student"`),
  więc nie jest to „zalogowany bez organizacji”.
- Krok 1: `POST /api/v1/teacher/quizzes {name:"x"}` → **403 `FORBIDDEN`**, nagłówek
  `x-error-code: FORBIDDEN`, treść dokładnie `{"success":false,"error":"FORBIDDEN"}` — bez
  `data`. Ten sam request z niepoprawnym ciałem (`{}`) również zwraca **403**, a nie 422:
  reguła konta działa przed walidacją wejścia.
- Krok 2: `POST /api/v1/teacher/assignments {title:"x", …}` → **403 `FORBIDDEN`** (identyczna
  koperta), także z pustym ciałem.
- Krok 3: `GET /api/v1/stats/teacher` → **403 `FORBIDDEN`**, bez jakichkolwiek danych
  nauczyciela w odpowiedzi.
- „Brak utworzenia zasobów” potwierdzone w bazie klientem service-role: po trzech próbach
  organizacja ma **0** wierszy w `quizzes` i **0** w `teacher_assignments`, a żaden wiersz w
  tych tabelach nie ma `created_by` studenta.
- Ścieżki sąsiednie: `GET /api/v1/teacher/quizzes` i `GET /api/v1/teacher/assignments` również
  zwracają **403** dla studenta (ta sama reguła tras).
- Kontrola pozytywna (ten sam tenant, ta sama aktywna organizacja): nauczyciel tworzy quiz i
  kartkówkę (**201**) oraz czyta statystyki nauczyciela (**200**) — odrzucenie studenta to
  granica uprawnień, nie zepsuta trasa ani fixture. Student nadal korzysta z własnego panelu:
  `/app` się ładuje, `GET /api/v1/stats/student` → **200**.
- Produkt zachowuje się zgodnie z oczekiwanym rezultatem przypadku — brak odstępstw
  funkcjonalnych do zgłoszenia.
