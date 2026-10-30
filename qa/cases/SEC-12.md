# SEC-12 — Endpointy deweloperskie

- id: SEC-12
- priority: P2 ważny
- module: SEC – Autoryzacja i izolacja danych
- section: Walidacja wejścia i odporność
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Środowisko development i (jeśli możliwe) build produkcyjny.

## Prerequisite context (tenant model)

Ten przypadek nie potrzebuje treści — potrzebuje **zalogowanego użytkownika**, żeby
udowodnić, że brama środowiskowa obowiązuje także wtedy, gdy wywołujący ma ważną sesję
(i nie jest tylko anonimowy). Automatyzacja używa więc konta studenta z własnego,
pustego tenanta tego przypadku (bez organizacji i bez grupy); stare konto
`student1@dev.local` z hasłem `pass` nie jest używane.

Środowisko: QA-suite ma **jeden wspólny build produkcyjny** (`next start`, port 3010),
więc wykonywalna jest wyłącznie produkcyjna połowa przypadku (krok 2). Połowa
„development” (krok 1) wymaga drugiego, deweloperskiego serwera, którego ten runner nie
uruchamia — specyfikacja pinuje produkcyjną bramę, czyli właściwość bezpieczeństwa z
oczekiwanego rezultatu.

## Seed (QA-suite tenant)

```bash
bun scripts/qa-tenant.ts SEC-12 --fresh
```

- Profil tenanta: `__tests__/qa/profiles/SEC-12.json` =
  `{ "profile": "bare", "role": "student" }` — jedno konto studenta bez organizacji
  i bez grupy, hasło `Seed4Test!`.
- Klucz tenanta: `SEC-12.md::SEC-12#<run>::qa-shared`
  (`tenantKey('qa/cases/SEC-12.md', 'SEC-12#<run>', 'qa-shared')` + `tenantId`), z nowym
  sufiksem przy każdym niezależnym przebiegu.
- Specyfikacja nie tworzy ani nie zmienia żadnych wierszy: wywołuje tylko dwa endpointy
  deweloperskie i kontrolnie `/api/v1/auth/me`. Żaden globalny wiersz (ustawienia
  admina, flagi funkcji, plany, statystyki, singletony) nie jest czytany ani zapisywany.

## Steps

1. Wywołaj GET /api/v1/dev/traces oraz POST /api/v1/dev/study-simulate {"email":"seed-student-…@dev.local"}.
2. Powtórz na buildzie produkcyjnym (bun build, bun start).

## Expected result

- W development działają. W buildzie produkcyjnym: traces → 403 „Only available in development mode”, study-simulate → 404 „Not available in production”. Jakakolwiek inna odpowiedź = defekt krytyczny.

## Observed during the suite walk (shared app 3010 / DB 54421, production build)

- Anonimowo: `GET /api/v1/dev/traces` → **403** `{"error":"Only available in development mode"}`;
  `POST /api/v1/dev/study-simulate` z e-mailem istniejącego studenta → **404**
  `{"error":"Not available in production"}`. Oba `Content-Type: application/json`.
- Po zalogowaniu na konto studenta z tenanta (sesja potwierdzona przez
  `/api/v1/auth/me` → 200 z `user.id`): identyczne **403** i **404** z tymi samymi
  treściami. Sesja nie odblokowuje endpointów, bo brama `NODE_ENV !== 'development'`
  działa przed `withAuth`.
- Parametry zapytania (`?serverSessionId=all&limit=2000`) nie zmieniają odpowiedzi —
  nadal 403 i ten sam komunikat; body `study-simulate` nie ma znaczenia, bo trasa
  kończy się przed odczytem JSON-a i przed jakimkolwiek zapisem.
- Odpowiedź 403/404 zawiera wyłącznie `error` — brak `events`, `total`, `dbStatus`,
  `updated` czy `cards`, więc żadne dane trace'ów ani wynik symulacji nie wycieka.
- Krok 1 (development) nie został wykonany: runner QA-suite stawia tylko produkcyjny
  build, a uruchamianie drugiego serwera jest poza kontraktem wspólnej aplikacji.
