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
tenanta `content` — organizacji z managerem (`admin`), nauczycielem, studentem i grupą
domyślną:

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
- Organizacja: `qa-mgr-02-<suffix>` (plan `launch`), grupa domyślna `G1`.
- Worker QA-suite seeduje **wspólną** bazę (`http://localhost:54421`); `scripts/qa-tenant.ts`
  bierze URL z `qa/env.json`, a klucz service role z `apps/web/.env`.
- Spec: `qa/tests/MGR/MGR-02.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl` (pozycje menu w przypadku są polskie).
- Izolacja: test czyta wyłącznie menu i strony `/manage/*` swojej organizacji; nie dotyka
  flag funkcji, katalogu planów, statystyk platformy ani wierszy singletonowych.

## Steps

1. Kliknij każdą pozycję menu.

## Expected result

- Sekcje: Główne (Przegląd, Asystent Q), Administracja (Członkowie, Zaproszenia, Grupy, Zgłoszenia, Role, Licencje, Ustawienia).
- ZNANY PROBLEM: „Asystent Q” prowadzi do /manage/ai, którego nie ma w aplikacji (spodziewane 404); dodatkowo API AI nie jest dozwolone dla managera – zanotuj zachowanie.

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
  `36689a6d`, „add /edu/ai route and drop dead /manage/ai nav link”), bo
  `POST /api/v1/ai/chat` dopuszcza tylko `student` i `educator`
  (`allowedAccountTypes`). Manager nie ma więc asystenta, do którego mógłby prowadzić
  wpis. Lista sekcji w „Expected result” opisuje stan sprzed naprawy (sam objaw
  defektu), a nie zachowanie zamierzone.
- Wejście bezpośrednio na `/manage/ai` (spoza menu) zwraca **HTTP 404** i renderuje
  własną stronę 404 panelu managera: nagłówki „404” i „Nie znaleziono strony”, link
  „Wróć do panelu” → `/manage` oraz skróty „Przejdź do:” → `/manage`, `/manage/members`,
  `/manage/invites`, `/manage/settings`.
- `POST /api/v1/ai/chat` wywołane sesją menedżera zwraca **403**
  `{"success":false,"error":"FORBIDDEN"}` (nagłówek `x-error-code: FORBIDDEN`) — to
  odpowiada uwadze „API AI nie jest dozwolone dla managera”.
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
  „Wykładowcy”, „Studenci” i karta „Szybkie akcje”. Strony „Role” i „Licencje” działają,
  ale przy planie `launch` pokazują blokadę planu („Kreator ról nie jest dostępny w Twoim
  planie”, brak pul miejsc) — to zachowanie planu, nie brak strony.
- Nagłówek „Licencje miejsc” różni się od etykiety menu „Licencje”; etykieta w teście
  pochodzi z paska bocznego, a nagłówek z treści strony.
