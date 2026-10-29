# AUT-19 — API bez sesji i z niewłaściwą rolą

- id: AUT-19
- priority: P1 krytyczny
- module: AUT – Uwierzytelnianie i sesja
- section: Ochrona tras – macierz ról
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Okno bez sesji; potem sesja studenta.

## Steps

1. Bez logowania otwórz w przeglądarce /api/v1/flashcards/decks oraz /api/v1/teacher/quizzes.
2. Zaloguj się jako student1 i otwórz /api/v1/teacher/quizzes oraz /api/v1/organization/members.

## Expected result

- Bez sesji: JSON {success:false, error:…UNAUTHORIZED} z kodem 401.
- Student na /api/v1/teacher/*: kod 403 FORBIDDEN.
- Student na /api/v1/organization/members: brak danych członków (403 lub pusta lista – dane innych użytkowników nie mogą wyciec).

## Seed (QA-suite tenant)

Automatyzacja nie używa konta `student1@dev.local` z ręcznego seeda. Przypadek
korzysta z własnego, izolowanego tenanta (schemat `tenantKey`/`tenantId` wspólny z
e2e), a student jest zwykłym członkiem jego organizacji — ten sam kształt co S1:

```bash
bun scripts/qa-tenant.ts AUT-19 --profile content --fresh
```

- Klucz tenanta: `AUT-19.md::AUT-19#<run>::qa-shared` —
  `tenantKey('qa/cases/AUT-19.md', 'AUT-19#<run>', 'qa-shared')`, bez nowego
  schematu ID.
- Profil `content`: menedżer, nauczyciel i student w organizacji `qa-aut-19-<run>`
  oraz domyślna grupa `G1`. Spec czyta dane logowania z
  `qa/.tenants/AUT-19.json` (`users.student` / `users.teacher`, hasło
  `Seed4Test!`) i nie tworzy kont samodzielnie.
- `--fresh` dla każdego niezależnego uruchomienia: świeży sufiks w kluczu, więc
  adresy i identyfikatory są deterministyczne w obrębie przebiegu, a kolejne
  przebiegi nie kolidują ze sobą ani z innymi tenantami. Spec nie zależy od
  sufiksu, więc ten sam plik działa też na stabilnym tencie z CI
  (`bun scripts/qa-tenant.ts AUT-19`).
- Izolacja: spec nie czyta ani nie zapisuje globalnych ustawień admina, flag
  funkcji, planów, statystyk platformy ani wierszy singletonowych; nie dotyka
  innego tenanta. Lista członków, której studentowi odmówiono, należy wyłącznie
  do organizacji tego tenanta.

## Observed during the suite walk (shared app 3010 / DB 54421)

- Bez sesji `GET /api/v1/flashcards/decks` i `GET /api/v1/teacher/quizzes` →
  **401** z ciałem dokładnie `{"success":false,"error":"UNAUTHORIZED"}`,
  `content-type: application/json` i nagłówkiem `x-error-code: UNAUTHORIZED`.
  Ten sam wynik daje `GET /api/v1/organization/members` (ta sama bramka sesji,
  sprawdzana przed rolą).
- Po zalogowaniu na konto studenta tenanta (`users.student`) i ustawieniu
  aktywnej organizacji (cookie `active_org_id`, jak w fixture):
  - `GET /api/v1/teacher/quizzes` → **403** `{"success":false,"error":"FORBIDDEN"}`;
  - `GET /api/v1/organization/members` → **403** `{"success":false,"error":"FORBIDDEN"}`
    (wariant „pusta lista” z treści przypadku nie występuje; brak jakichkolwiek
    danych członków w odpowiedzi);
  - `GET /api/v1/flashcards/decks` → **200** `{"success":true,"data":{...}}`, czyli
    trasa studenta działa na tej samej sesji — 401/403 dotyczą sesji i roli, a nie
    zepsutej trasy.
- Kontrola dodatnia: nauczyciel tenanta dostaje **200** na
  `/api/v1/teacher/quizzes` (pusta lista quizów) oraz **200** na
  `/api/v1/organization/members`; lista zawiera konta wyłącznie z organizacji
  tenanta (`organization_id` = organizacja przypadku), w tym studenta, któremu
  ta sama trasa zwróciła 403.
