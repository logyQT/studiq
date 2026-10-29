# STU-36 — Kartkówka – maks. liczba prób

- id: STU-36
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Kartkówki studenta (/app/assignments)
- prereqs: kartkówka z maks. prób = 1, opublikowana i przypisana uczniowi
- source: StudiQ Dokument Testera v1.3

## Tenant (QA-suite seed)

- Profil: `content` (`qa/tests/profiles/STU-36.json`).
- Seed: `bun scripts/qa-tenant.ts STU-36 --fresh` — organizacja
  `qa-stu-36-<suffix>`, manager, nauczyciel i uczeń, domyślna grupa `G1`.
  Wszystkie id pochodzą z `tenantKey('qa/cases/STU-36.md', 'STU-36#<suffix>', 'qa-shared')`
  - `tenantId`.
- Konta: nauczyciel (`tenant.users.teacher`) tworzy kartkówkę, uczeń
  (`tenant.users.student`) ją rozwiązuje i próbuje rozpocząć ponownie.
- Prerequisite „kartkówka z maks. prób = 1” nie jest już ręcznym seedem: spec buduje ją
  przez API produktu w własnej organizacji tenanta — bank `STU-36 bank`, jedno pytanie
  wielokrotnego wyboru, opublikowana kartkówka `STU-36 kartkówka` z `maxAttempts: 1`,
  `showResults: true`, bez losowania, przypisana do grupy tenanta. Fixture jest
  odtwarzany na początku każdego uruchomienia, więc retry na tym samym tenancie startuje
  z nowej, nierozwiązanej kartkówki.
- Mapowanie legacy: `student1@dev.local` (WSB Merito, grupa O1G1) → uczeń tenanta;
  `teacher-classroom@dev.local` → nauczyciel tenanta. Żadne konto `@dev.local` ani hasło
  `pass` nie jest używane.

## Prerequisite (verbatim)

Kartkówka z maks. prób = 1.

## Steps

1. Ukończ kartkówkę.
2. Spróbuj ją rozpocząć ponownie (z listy oraz bezpośrednim URL /api/v1/assignments/<id>/start).

## Expected result

- Nie można zacząć drugiej próby ponad limit; UI ukrywa przycisk startu lub pokazuje błąd.
- Wywołanie API zwraca błąd (nie tworzy kolejnej próby).

## Obserwacje (walk na współdzielonej aplikacji, 2026-10-29)

- Przed próbą lista `/app/assignments` pokazuje kartkówkę w sekcji „Oczekujące (1)”,
  a strona szczegółów przycisk „Rozpocznij kartkówkę”.
- Po wysłaniu odpowiedzi strona szczegółów pokazuje „Ukończono”, „Wynik: 1/1” i link
  „Zobacz podsumowanie”; przycisk startu/kontynuacji znika.
- Lista przenosi kartkówkę do „Ukończone (1)” z wynikiem `1/1`; wejście z listy nadal
  nie daje przycisku startu.
- `POST /api/v1/assignments/<id>/start` zwraca `429` z `{"success":false,"error":"RATE_LIMITED"}`;
  `attempts_used` pozostaje `1`, a najnowsza próba to nadal próba ukończona — żadna nowa
  próba nie powstaje.
- Przy `max_attempts = 1` strona szczegółów nie renderuje linii „Pozostało prób” /
  „Wykorzystano wszystkie próby” (jest ona warunkowana `max_attempts > 1`); ukrycie
  przycisku startu spełnia oczekiwany rezultat, więc to nie jest usterka.
