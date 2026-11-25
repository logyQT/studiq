# EDU-ASG-11 — Kartkówka kolegi z klasy, której uczę

- id: EDU-ASG-11
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Kartkówki (/edu/assignments)
- prereqs: none
- source: ADR-0015 §4.3 i §12, decyzja D29 (faza 6e)

## Prerequisite (verbatim)

Nauczyciel należy do organizacji z drugim nauczycielem; każdy z nich uczy inną
klasę (G1 albo G2).

## Steps

1. Zaloguj się jako **drugi nauczyciel** i utwórz kartkówkę z jednym pytaniem
   („EDU-ASG-11 obca kartkówka”), wskazując w „Grupy” klasę **G1** — klasę,
   której uczy pierwszy nauczyciel. Nie publikuj: lista pokazuje także szkice.
2. Utwórz drugą kartkówkę z tym samym pytaniem („EDU-ASG-11 obca kartkówka
   (obca klasa)”) i wskaż klasę **G2** — klasę, której pierwszy nauczyciel nie
   uczy.
3. Zaloguj się jako **pierwszy nauczyciel** i otwórz `/edu/assignments`.
4. Sprawdź listę kartkówek oraz odpowiedź
   `GET /api/v1/teacher/assignments`.
5. Otwórz kartkówkę kolegi wskazaną na G1 (`/edu/assignments/<id>`) i sprawdź
   `GET /api/v1/teacher/assignments/<id>`.

## Expected result

- Lista `/edu/assignments` zawiera kartkówkę kolegi wskazaną na **G1**: karta z
  tytułem „EDU-ASG-11 obca kartkówka”, statusem „Szkic” i pytaniem („1 pytanie”).
  Prawo `assignment.read` obowiązuje w zakresie `group`, a zakres grupowy
  obejmuje klasy, których nauczyciel **uczy** (ADR-0015 §4.3).
- Lista **nie zawiera** kartkówki wskazanej na **G2**: to klasa, której
  nauczyciel nie uczy, więc jej kartkówki nie są jego lekturą.
- `GET /api/v1/teacher/assignments` → **200**; identyfikator kartkówki na G1
  jest w odpowiedzi, identyfikator kartkówki na G2 — nie.
- Otwarcie kartkówki kolegi jest **odmową**: strona pokazuje stan
  „Nie znaleziono kartkówki” z akcją „Powrót do kartkówek”, a nie kompozytor.
  `GET /api/v1/teacher/assignments/<id>` → **403 FORBIDDEN**. Kompozytor
  (i klucz odpowiedzi) należy do autora, dlatego lista jest szersza niż
  szczegół (R23; właściciel dalszej pracy: faza 7).

## Seed (QA-suite tenant)

Przypadek nie korzysta z ręcznego seeda (`teacher-classroom@dev.local`, `pass`).
Ma własny profil z dwoma nauczycielami i dwiema klasami:

```bash
bun scripts/qa-tenant.ts EDU-ASG-11 --fresh
```

- Plik profilu: `__tests__/qa/profiles/EDU-ASG-11.json` — profil `content` z
  jawnym składem: `manager` (rola `admin`), `teacher` i `teacher2` (rola
  `teacher`), `student` (rola `member`), klasy `G1` (domyślna) i `G2`.
- `groupTeachers: { "teacher": ["G1"], "teacher2": ["G2"] }` — seeder wpisuje
  każdemu nauczycielowi rolę `teacher` w jego klasie (`teacher` → G1,
  `teacher2` → G2); `teacher2` pozostaje przy tym zwykłym `member` klasy domyślnej
  G1. Pierwszy nauczyciel uczy więc G1 i nie jest członkiem G2, dlatego
  kartkówka wskazana na G2 jest poza jego zakresem grupowym — a konto `teacher2`
  (autora) jest kontrolą, że oba wiersze naprawdę istnieją.
- Klucz tenanta: `tenantKey('qa/cases/EDU-ASG-11.md', 'EDU-ASG-11#<run>',
'qa-shared')`; identyfikatory organizacji, klas i kont pochodzą z `tenantId`,
  więc są deterministyczne w obrębie przebiegu. Identyfikator `G2` to
  `tenantId(key, 'group:2')` — seeder nie zapisuje go w pliku tenanta.
- Oba konta nauczycieli używają `loginAs(page, tenant, 'teacher' | 'teacher2',
{ locale: 'pl' })`. Kartkówki buduje spec przez API produktu w tym tenancie;
  nic globalnego nie jest zapisywane ani czytane (bez flag, planów, statystyk
  platformy i wierszy singletonowych) i żaden inny tenant nie jest dotykany.
- Spec: `__tests__/qa/EDU/EDU-ASG-11.spec.ts`, projekt
  `__tests__/qa/playwright.qa.config.ts`.
