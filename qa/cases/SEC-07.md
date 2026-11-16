# SEC-07 — Manager nie korzysta z API AI

- id: SEC-07
- priority: P2 ważny
- module: SEC – Autoryzacja i izolacja danych
- section: Uprawnienia ról
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

manager@dev.local.

## Seed (QA-suite tenant)

Automatyzacja nie używa konta ręcznego seeda (`manager@dev.local`, hasło `pass`). Przypadek
dostaje własny tenant z nowym sufiksem przebiegu przy każdym niezależnym uruchomieniu:

```bash
bun scripts/qa-tenant.ts SEC-07 --fresh
```

- Profil domyślny `content` — ten przypadek nie potrzebuje pliku
  `__tests__/qa/profiles/SEC-07.json`, bo `content` jest domyślnym profilem seedera (tak jak
  np. `MGR-01`). Daje on organizację `qa-sec-07-<suffix>` z domyślną grupą `G1` oraz trzy
  konta, których wymaga przypadek:
  - `manager` (typ konta `manager`) — podmiot przypadku, odpowiednik `manager@dev.local`;
  - `teacher` (typ `educator`) i `student` (typ `student`) — dozwolona publiczność API AI,
    używana jako kontrola pozytywna (ta sama trasa, to samo ciało, inna rola).
- Hasło kont: `Seed4Test!`. Wszystkie identyfikatory (organizacja, użytkownicy, id rozmowy)
  pochodzą z `qa/.tenants/SEC-07.json`; id rozmowy zawiera sufiks przebiegu, więc dwa
  przebiegi nie dzielą nazwy wiersza.
- Przypadek **nie potrzebuje modelu**: reguła konta w `withAuth` odrzuca managera przed
  odczytem ciała żądania, a kontrole pozytywne zatrzymują się na walidacji wejścia (`400`),
  więc ani prawdziwy provider, ani serwer fake-LLM nie są tu wywoływane.
- Spec: `__tests__/qa/SEC/SEC-07.spec.ts`, uruchamiany przez `bun run test:qa` (w CI shard
  `mgr-sec-bil`), `NEXT_LOCALE=pl`.

## Steps

1. POST /api/v1/ai/chat z poprawnym ciałem.

## Expected result

- 403 FORBIDDEN (API AI dozwolone tylko dla studenta i nauczyciela).
