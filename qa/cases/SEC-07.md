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
  np. `MGR-01`). Daje on organizację `qa-sec-07-<suffix>` (plan `launch`) z domyślną grupą
  `G1` oraz trzy konta, których wymaga przypadek:
  - `manager` (typ konta `manager`, brak planu osobistego) — podmiot przypadku, odpowiednik
    `manager@dev.local`;
  - `teacher` (typ `educator`, plan osobisty `free`) — kontrola negatywna „to nie reguła dla
    managera”: ta sama organizacja i ten sam brak `ai.chat`, więc ten sam 403;
  - `student` (typ `student`, plan osobisty `free`) — kontrola pozytywna **przez plan, nie
    przez rolę**: spec przestawia `profiles.personal_plan_key` studenta na płatny plan `pro`
    klientem service-role (ten sam wzorzec co `LIM-03.spec.ts` / `STU-52.spec.ts`) i przywraca
    pierwotną wartość w bloku `finally`, żeby retry CI na tym samym tenancie startowało
    czysto.
- Plan `launch` nie niesie entitlementu `ai.chat` (a jego `max_ai_tokens_per_day = 0`), więc
  resolver nie czyni tego klucza efektywnym dla nikogo, kto opiera się na warstwie
  organizacji — w tym managera (brak planu osobistego) i nauczyciela (`free` też nie).
  Klucz `ai.chat` jest jednak `personalPortable`, więc płatny plan osobisty `pro` **niesie się
  wewnątrz organizacji** (D3): student na `pro` w tej samej organizacji `launch` ma
  `ai.chat` mimo że plan organizacji go nie przyznaje. To właśnie robi granicę planową, a nie
  osobową.
- Hasło kont: `Seed4Test!`. Wszystkie identyfikatory (organizacja, użytkownicy, id rozmowy)
  pochodzą z `qa/.tenants/SEC-07.json`; id rozmowy zawiera sufiks przebiegu, więc dwa
  przebiegi nie dzielą nazwy wiersza.
- Przypadek **nie potrzebuje modelu**: bramka entitlementu (`requireEntitlement(ctx,
'ai.chat')`, pierwsza instrukcja handlera) odrzuca managera i nauczyciela przed odczytem
  ciała żądania, a kontrola pozytywna studenta zatrzymuje się na walidacji wejścia (`400`),
  więc ani prawdziwy provider, ani serwer fake-LLM nie są tu wywoływane.
- Spec: `__tests__/qa/SEC/SEC-07.spec.ts`, uruchamiany przez `bun run test:qa` (w CI shard
  `mgr-sec-bil`), `NEXT_LOCALE=pl`.

## Steps

1. POST /api/v1/ai/chat z poprawnym ciałem jako manager tenanta.
2. POST /api/v1/ai/chat z pustym (`{}`) i uszkodzonym ciałem jako manager; GET
   /api/v1/ai/usage jako manager; POST /api/v1/ai/chat bez sesji.
3. GET /api/v1/me/entitlements i POST /api/v1/ai/chat z `{}` jako teacher (plan osobisty `free`).
4. GET /api/v1/me/entitlements, GET /api/v1/ai/usage i POST /api/v1/ai/chat z `{}` jako student
   po przestawieniu jego `profiles.personal_plan_key` na `pro`.

## Expected result

- 403 FORBIDDEN dla managera — API AI wymaga entitlementu `ai.chat` (ADR-0015 §7); plan
  `launch` tego tenanta go nie niesie (a manager nie ma planu osobistego), a bramka
  wykonuje się przed odczytem ciała żądania (puste i uszkodzone ciało też dostają 403, nigdy
  400). `GET /api/v1/me/entitlements` managera nie zawiera `ai.chat` — to dowód, że 403 pochodzi
  z entitlementu, a nie z typu konta. `GET /api/v1/ai/usage` managera → 403, wywołanie bez
  sesji → 401.
- Nauczyciel (plan osobisty `free` w tej samej organizacji `launch`) dostaje dokładnie ten
  sam 403 (i `/me/entitlements` bez `ai.chat`) — odmowa nie jest specyficzna dla managera.
- Student tej samej organizacji, ale z planem osobistym `pro`, dostaje `ai.chat` w
  `/me/entitlements`, `GET /api/v1/ai/usage` → 200 z `limit = 250000` (i `plan = 'launch'` —
  effective primary to plan organizacji; limit to user-scope `max(org 0, personal 250000)`),
  a `POST /api/v1/ai/chat` z `{}` → 400 BAD_REQUEST: bramka entitlementu go przepuściła, więc
  odpowiedziała walidacja handlera. To ten punkt kontrolny pokazuje, że granica jest planowa,
  nie osobową.
- `user_daily_activity` managera ma 0 tokenów AI dla dzisiejszej daty — odrzucone wywołania
  niczego nie zmierzyły.

## Mutation (proves the spec can fail)

Usunięcie `await requireEntitlement(ctx, 'ai.chat')` z trasy chatu (mutant „plan check is
enough”) sprawia, że manager dociera do handlera: poprawne ciało → 429
`USAGE_LIMIT_EXCEEDED` (limit 0 na `launch`), niepoprawne → 400 `BAD_REQUEST`; oba miały
być 403, więc spec jest czerwony. W drugą stronę: build, którego resolver zwraca pusty
zbiór entitlementów, przegrywa kontrolę studenta (`/me/entitlements` bez `ai.chat`, `ai/usage`
403), więc przypadek nie przechodzi też na pustym rozwiązaniu.
