# MGR-02 — Menu boczne managera

- id: MGR-02
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Pulpit managera
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany manager@dev.local.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`manager@dev.local`, `pass`). Menu
managera jest budowane dla aktywnej organizacji menedżera, więc przypadek potrzebuje
tenanta `content` na planie **Hub** — `__tests__/qa/profiles/MGR-02.json` deklaruje
`{ "profile": "content", "plan": "hub" }`, więc seeder applying `change_org_plan`
stawia organizację na Hub, a Hub niesie entitlement `ai.chat`:

```bash
bun scripts/qa-tenant.ts MGR-02 --fresh
```

- Klucz tenanta: `MGR-02.md::MGR-02#<run>::qa-shared` —
  `tenantKey('qa/cases/MGR-02.md', 'MGR-02#<run>', 'qa-shared')` + `tenantId`, ten sam
  schemat co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, więc każde niezależne
  uruchomienie dostaje świeżą organizację; identyfikatory są deterministyczne w obrębie
  przebiegu (bez losowych UUID).
- Konto menedżera: `seed-manager-<hash>@dev.local` / `Seed4Test!`,
  `app_metadata.account_type = manager`, rola `admin` w organizacji.
- Organizacja: `qa-mgr-02-<suffix>` (plan `hub`), grupa domyślna `G1`.
- Worker QA-suite seeduje **wspólną** bazę (`http://localhost:54421`); `scripts/qa-tenant.ts`
  bierze URL z `qa/env.json`, a klucz service role z `.env.local`.
- Spec: `__tests__/qa/MGR/MGR-02.spec.ts`, projekt `__tests__/qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl` (pozycje menu w przypadku są polskie).
- Izolacja: test czyta wyłącznie menu i strony `/manage/*` swojej organizacji; nie dotyka
  flag funkcji, katalogu planów, statystyk platformy ani wierszy singletonowych.

## Steps

1. Kliknij każdą pozycję menu.

## Expected result

- Sekcje: Główne (Przegląd), Administracja (Członkowie, Zaproszenia, Grupy, Zgłoszenia, Role, Licencje, Ustawienia).
- ZNANY PROBLEM (stary): „Asystent Q” prowadził do /manage/ai, którego nie ma w aplikacji (404).
  Link został usunięty w #134/#433, bo nie ma strony AI dla managera (powierzchnia UI/nav
  managera to ADR-0015 faza 6). API AI nie jest już bramkowane typem konta: od fazy 5a
  `POST /api/v1/ai/chat` i `GET /api/v1/ai/usage` wymagają entitlementu `ai.chat`
  (ADR-0015 §7), a ten tenant jest na planie Hub, więc manager **może** wywołać API —
  w menu nie ma wpisu, bo nie istnieje strona `/manage/ai`.

## Observed during the suite walk (qa-env-8, shared app 3010 / DB 54421)

- Pasek boczny `/manage` ma **dwie** sekcje, w tej kolejności: „Główne” i
  „Administracja”. Pozycje „Główne”: „Przegląd” (`/manage`). Pozycje „Administracja”, w
  kolejności: „Członkowie” (`/manage/members`), „Zaproszenia” (`/manage/invites`),
  „Grupy” (`/manage/groups`), „Zgłoszenia” (`/manage/reports`), „Role”
  (`/manage/roles`), „Licencje” (`/manage/seats`), „Ustawienia” (`/manage/settings`).
  Każda pozycja to `<a>` z `data-sidebar="menu-button"`; dokładnie odwiedzona pozycja ma
  `data-active="true"`.
- **ZNANY PROBLEM jest naprawiony, nie reprodukowany.** W menu managera **nie ma**
  „Asystent Q”: martwy link `/manage/ai` został usunięty w #134/#433 (commit
  `36689a6d`, „add /edu/ai route and drop dead /manage/ai nav link”), bo nie ma strony
  AI dla managera. Od fazy 5a (ADR-0015) API AI nie bramkuje już typu konta —
  `POST /api/v1/ai/chat` i `GET /api/v1/ai/usage` wymagają entitlementu `ai.chat`;
  ten tenant ma organizację na planie `hub`, który `ai.chat` niesie, więc manager
  może z API korzystać. Lista sekcji w „Expected result” opisuje stan sprzed naprawy
  (sam objaw defektu), a nie zachowanie zamierzone.
- Wejście bezpośrednio na `/manage/ai` (spoza menu) zwraca **HTTP 404** i renderuje
  własną stronę 404 panelu managera: nagłówki „404” i „Nie znaleziono strony”, link
  „Wróć do panelu” → `/manage` oraz skróty „Przejdź do:” → `/manage`, `/manage/members`,
  `/manage/invites`, `/manage/settings`.
- Strona managera (`GET /api/v1/features/me`) zawiera `ai.chat` w `data.features`
  (organizacja na Hub, rola `admin` z profilem `all`).
- `GET /api/v1/ai/usage` sesją menedżera zwraca **200** z `data.plan = "hub"` i
  `data.limit = 200000` — licznik AI managera na Hub.
- `POST /api/v1/ai/chat` z pustym ciałem `{}` sesją menedżera zwraca **400**
  `{"success":false,"error":"BAD_REQUEST"}` (nagłówek `x-error-code: BAD_REQUEST`) —
  bramka entitlementu przepuściła managera, odpowiedziała walidacja handlera;
  żaden model nie został wywołany.
- Wszystkie osiem pozycji otwiera działającą stronę (`200`), bez strony 404:

  | Pozycja     | Adres              | Nagłówek `<main>` |
  | ----------- | ------------------ | ----------------- |
  | Przegląd    | `/manage`          | brak (kafelki)    |
  | Członkowie  | `/manage/members`  | Członkowie        |
  | Zaproszenia | `/manage/invites`  | Zaproszenia       |
  | Grupy       | `/manage/groups`   | Grupy             |
  | Zgłoszenia  | `/manage/reports`  | Zgłoszenia        |
  | Role        | `/manage/roles`    | Role              |
  | Licencje    | `/manage/seats`    | Licencje miejsc   |
  | Ustawienia  | `/manage/settings` | Ustawienia        |

- Pulpit (`/manage`) nie ma nagłówka; rozpoznają go kafelki „Łączna liczba członków”,
  „Wykładowcy”, „Studenci” i karta „Szybkie akcje”. Strony „Role” i „Licencje” otwierają
  się na planie `hub` z własnym nagłówkiem i kodem 200; spec asertuje nagłówek i brak
  strony 404, a zawartość kart planu nie jest przedmiotem przypadku.
- Nagłówek „Licencje miejsc” różni się od etykiety menu „Licencje”; etykieta w teście
  pochodzi z paska bocznego, a nagłówek z treści strony.
