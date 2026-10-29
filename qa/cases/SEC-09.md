# SEC-09 — Kartkówki i wyniki cudzych uczniów

- id: SEC-09
- priority: P1 krytyczny
- module: SEC – Autoryzacja i izolacja danych
- section: Uprawnienia ról
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

student1 i student-classroom; opublikowana kartkówka w Classroom.

## Prerequisite context (tenant model)

W ręcznym seedzie „Classroom” to osobna organizacja: `teacher-classroom` (TC) jest jej
adminem i autorem opublikowanej kartkówki, a `student-classroom` (SC) jej członkiem.
`student1` (S1) i `teacher1` (T1) należą do innych organizacji (WSB Merito / UE Wrocław),
więc nie widzą ani kartkówki, ani próby SC, ani jej wyników.

Automatyzacja nie używa kont ręcznego seeda (`@dev.local`, hasło `pass`) ani organizacji
„Classroom” z ręcznego seeda. Przypadek dostaje własny tenant, a role odtwarza się w nim
tak, aby atak był co najmniej tak silny jak w seedzie ręcznym:

- **TC (autor kartkówki) = `teacher2`** — konto typu `educator`, w organizacji tenanta rola
  `teacher`. Tworzy **własną organizację „klasy”** przez API produktu
  (`POST /api/v1/organization`, ten sam przepływ, którym nauczyciel zakłada organizację w
  onboardingu) i zostaje jej adminem. Nazwa organizacji zawiera sufiks przebiegu, więc
  należy wyłącznie do tego tenanta.
- **SC (uczeń klasy) = `invitee1`** — konto studenta zaproszone przez TC do organizacji
  klasy (`POST /api/v1/organization/invites/bulk`, rola `member`) i przyjmujące zaproszenie
  (`POST /api/v1/organization/invites/accept`). SC jest więc członkiem organizacji klasy,
  a kartkówka jest do niego zaadresowana i to on rozpoczął próbę.
- **S1 (student1, obcy uczeń) = `invitee2`** — konto studenta **bez organizacji**
  (`GET /api/v1/me/orgs` = `[]`); to najbliższy odpowiednik „studenta z innej
  organizacji”, jaki daje profil tenanta (ta sama podstawa co w SEC-08).
- **T1 (teacher1, obcy nauczyciel) = `teacher`** — konto typu `educator`, w organizacji
  tenanta rola `teacher`. Jest aktywny w organizacji tenanta i **nie jest członkiem
  organizacji klasy** — czyli dokładnie „nauczyciel z innej organizacji”.

Sam profil `org-limit` nie może wyrazić dwóch organizacji z osobnym nauczycielem w każdej
(seeduje jednego admina, dwóch nauczycieli i członka w jednej organizacji oraz dwa konta
studentów poza nią), więc organizację klasy zakłada w trakcie przebiegu nauczyciel tego
tenanta przez API produktu — tak samo, jak specyfikacje EDU tworzą własne banki, pytania
i kartkówki. Nie jest to zmiana seedera ani żadnego fixture'u.

## Seed (QA-suite tenant)

```bash
bun scripts/qa-tenant.ts SEC-09 --fresh
```

- Profil tenanta: `qa/tests/profiles/SEC-09.json` = `"org-limit"` — organizacja
  `qa-sec-09-<run>` z adminem (`manager`), dwoma nauczycielami (`teacher`, `teacher2`;
  oba typu `educator` z rolą `teacher`), członkiem (`student`) i grupą domyślną `G1`,
  oraz dwoma kontami studentów **poza organizacją** (`invitee1`, `invitee2`).
- Klucz tenanta: `tenantKey('qa/cases/SEC-09.md', 'SEC-09#<run>', 'qa-shared')` +
  `tenantId(key, entity)` — ten sam schemat co fixture'y e2e, bez nowego schematu ID.
  Sufiks przebiegu wchodzi w nazwy organizacji klasy, banku, pytania i kartkówki, więc
  dwa przebiegi nigdy nie kolidują.
- Kartkówka („opublikowana kartkówka w Classroom”) powstaje w organizacji klasy przez API
  produktu: bank → jedno pytanie zamknięte (`mcq`) → `POST /api/v1/teacher/assignments`
  → dodanie pytania → `PUT .../targets` z `studentIds: [SC]` → `POST .../publish`.
  Następnie SC rozpoczyna próbę (`POST /api/v1/assignments/<id>/start`) i pozostawia ją
  otwartą (bez wysłania), bo krok 2 potrzebuje `attemptId`.
- Idempotencja na tym samym tenancie (CI seeduje raz i powtarza z `--retries`):
  organizacja klasy jest odnajdywana po nazwie w `GET /api/v1/me/orgs`, zaproszenie SC
  jest pomijane, gdy jest już członkiem (`GET /api/v1/organization/members`), bank,
  pytanie i kartkówka są odnajdywane po nazwie/treści, publikacja jest pomijana, gdy
  kartkówka jest już opublikowana, a `start` zwraca tę samą otwartą próbę.
- Izolacja: spec czyta i zapisuje wyłącznie wiersze swojego tenanta (jego organizacja,
  jego organizacja klasy, jego konta). Nie dotyka globalnych ustawień admina, flag
  funkcji, katalogu planów, statystyk platformy ani wierszy singletonowych, ani innego
  tenanta.

## Steps

1. Jako student1: GET /api/v1/assignments/<id kartkówki Classroom>.
2. GET /api/v1/quiz/<attemptId SC>.
3. Jako teacher1 (inna organizacja): GET /api/v1/teacher/assignments/<id>/results.

## Expected result

- Brak dostępu do cudzej kartkówki, próby i wyników (403/404).

## Observed during the suite walk (qa-env-8, shared app 3010 / DB 54421, pl)

Przebieg na tenancie `SEC-09#rmvtgbff18c4b` (organizacja `qa-sec-09-rmvtgbff18c4b`);
organizacja klasy `SEC-09 Classroom rmvtgbff18c4b`.

- TC (`teacher2`, `educator`, rola `teacher`): `POST /api/v1/organization
{name:"SEC-09 Classroom <run>"}` → **201**, w odpowiedzi `adminRoleId`, `memberRoleId`,
  `defaultGroupId`, plan `launch`; `GET /api/v1/me/orgs` pokazuje ją jako aktywną z
  `orgRoleName: "admin"`, a organizację tenanta jako nieaktywną (`teacher`).
- TC zaprasza SC: `POST /api/v1/organization/invites/bulk` z rolą `member` → **200**,
  32-hex `inviteCode`; SC przyjmuje `POST /api/v1/organization/invites/accept` → **200**,
  `GET /api/v1/me/orgs` pokazuje organizację klasy jako aktywną z `orgRoleName: "member"`.
- TC tworzy kartkówkę w organizacji klasy: bank → **201** (`organization_id` = organizacja
  klasy), pytanie `mcq` → **201**, `POST /api/v1/teacher/assignments` → **201**
  (`created_by` = TC, `organization_id` = organizacja klasy), dodanie pytania → **200**,
  `PUT .../targets {studentIds:[SC]}` → **200**, `POST .../publish` → **200**
  (`status: "published"`, `question_count: 1`, `total_points: 1`).
- SC: `GET /api/v1/assignments` → **200** z kartkówką; `POST
/api/v1/assignments/<id>/start` → **200**, próba `f74b37b0-…`, `user_id` = SC,
  `completed_at: null`; `GET /api/v1/assignments/<id>` → **200** (`attempt.id` = próba SC);
  `GET /api/v1/quiz/<attemptId>` → **200**. Strona `/app/assignments/<id>` renderuje
  nagłówek „SEC-09 kartkówka”, sekcje „Pytania 1”, „Punkty 1” i przycisk „Kontynuuj”.
- Krok 1 — S1 (`invitee2`, student bez organizacji, `GET /api/v1/me/orgs` = `[]`):
  `GET /api/v1/assignments/<id kartkówki>` → **404 `NOT_FOUND`**, koperta
  `{"success":false,"error":"NOT_FOUND"}`, nagłówek `x-error-code: NOT_FOUND`,
  `GET /api/v1/assignments` → **200** z pustą listą `[]`. Strona
  `/app/assignments/<id>` pokazuje **„Nie znaleziono kartkówki”**.
- Krok 2 — S1: `GET /api/v1/quiz/<attemptId SC>` → **404 `NOT_FOUND`** (ta sama koperta,
  brak `data`); próba SC nie wycieka.
- Krok 3 — T1 (`teacher`, `educator`, rola `teacher`, aktywna organizacja tenanta,
  `GET /api/v1/me/orgs` = tylko organizacja tenanta, bez organizacji klasy):
  `GET /api/v1/teacher/assignments/<id>/results` → **404 `NOT_FOUND`**;
  ścieżki sąsiednie tego samego ekranu: `GET .../teacher/assignments/<id>` → **404**,
  `GET .../results/<SC>` → **404**, `GET .../export-answers` → **404**,
  `GET /api/v1/teacher/assignments` → **200** z pustą listą `[]`.
  Strona `/edu/assignments/<id>/results` renderuje nagłówek „Wyniki” z **pustą** tabelą —
  brak wiersza i adresu e-mail SC w DOM.
- Kontrola pozytywna (ten sam tenant, ta sama organizacja klasy): TC czyta
  `GET /api/v1/teacher/assignments/<id>/results` → **200** z wierszem próby SC
  (`user.email` SC), `.../results/<SC>` → **200**, `.../export-answers` → **200** (CSV z
  wierszem SC); strona `/edu/assignments/<id>/results` pokazuje „Wyniki” i wiersz
  `QA invitee 1` z adresem SC i statusem „W trakcie”. Trasy są sprawne — 404 to granica
  organizacji/własności zasobu, nie awaria endpointu.
- Brak wycieku: żadna z odmówionych odpowiedzi nie zawiera `data`, a cudzy uczeń i cudzy
  nauczyciel nie widzą tytułu kartkówki, pytań ani adresu e-mail ucznia klasy.
