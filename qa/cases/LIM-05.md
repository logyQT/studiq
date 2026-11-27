# LIM-05 — Branding wymaga funkcji branding

- id: LIM-05
- priority: P1 krytyczny
- module: LIM – Funkcje (feature flags) i limity planów
- section: Bramkowanie funkcji
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

M1 (Launch).

## Steps

1. Wykonaj MGR-SET-01, MGR-SET-02, MGR-SET-05.
2. Wywołaj PUT /api/v1/organization/<id> z {"brandColor":"#ff0000"} oraz POST …/logo jako manager bez funkcji.

## Expected result

- Bez funkcji: UI blokuje, API odrzuca (403) – brak zmiany koloru/logo.

## Seed (QA-suite tenant)

Przypadek był pisany pod ręczny seed (`manager@dev.local`, `pass`, „M1, WSB Merito”). W suite
konto i organizacja pochodzą wyłącznie z tenanta przypadku; skrót M1 odpowiada
`users.manager` (admin organizacji), a „WSB Merito (Launch)” — własnej organizacji tenanta.

```bash
bun scripts/qa-tenant.ts LIM-05 --fresh
```

- `__tests__/qa/profiles/LIM-05.json` deklaruje `{ "profile": "content", "plan": "hub" }`. Profil
  `content` tworzy organizację `qa-lim-05-<suffix>` z managerem (`admin`), nauczycielem i
  studentem; `plan: "hub"` przenosi **tę jedną** organizację na Hub przez `change_org_plan`.
  Drabinka organizacji jest kumulatywna: `branding` ma tylko **Campus**, a Hub jest najwyższym
  planem self-serve bez tej funkcji. Tenant na Hubie jest więc celowo w stanie „najwyższy
  self-serve tier nadal nie ma brandingu”. Wartości logo i koloru, które zostawiłaby
  organizacja na Campusie, spec zapisuje bezpośrednio w wierszu **swojej** organizacji
  (fixture), żeby dowieść, że ukrywa je bramka, a nie brak danych.
- Klucz tenanta: `LIM-05.md::LIM-05#<run>::qa-shared` —
  `tenantKey('qa/cases/LIM-05.md', 'LIM-05#<run>', 'qa-shared')` + `tenantId` dla org, grup i
  użytkowników, ten sam schemat co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, więc
  każde niezależne uruchomienie dostaje świeżą organizację; identyfikatory są deterministyczne
  w obrębie przebiegu (bez losowanych UUID). Spec czyta tenant przez `loadTenant('LIM-05')`.
- Krok 1 przypadku („Wykonaj MGR-SET-01, MGR-SET-02, MGR-SET-05”) jest odtworzony w jednym
  tenancie: organizacja na Hubie ze zapisanymi wartościami logo/koloru pokazuje kartę
  blokady, brak pól wgrywania i koloru oraz nie maluje zapisanych wartości — bo `branding`
  przyznaje tylko Campus. Spec nie przenosi organizacji na Campus: bada stan tenanta na Hubie,
  a plan pozostaje `hub` przez cały przebieg.
- Izolacja: test czyta i zapisuje wyłącznie logo, kolor marki i plan **swojej** organizacji;
  nie dotyka flag funkcji, katalogu planów, ustawień admina, statystyk platformy ani wierszy
  singletonowych, ani innego tenanta.

## Observed during the suite walk (qa-env-2, shared app 3010 / DB 54421, 2026-10-29; plan names from the pre-#1493 matrix — Campus carries branding today, Hub does not)

- The branding tier at the time (`Hub`; today **Campus**): `/api/v1/me/entitlements` contained
  `branding`, and `/manage/settings` showed
  „Brak logo” / „Wgraj logo” (ukryty `input[type=file]`), „Kolor marki” z `input[type=color]`
  i przyciskiem „Zapisz”. Wgranie PNG 1×1 (`POST …/logo`) zwraca 200 i zapisuje
  `organizations.logo_url` pod `org-logos/<org-id>/…png`; zapis koloru (`PUT` z
  `brandColor`) zwraca 200 i zapisuje `#00aa00`; po odświeżeniu podgląd logo ma 48×48, a pole
  koloru pokazuje zapisaną wartość.
- After a plan change to a tier without branding (then `launch`; today **Hub**, this tenant's
  state): `/api/v1/me/entitlements` omits `branding`,
  `/api/v1/me/plan` zwraca plan bez funkcji. `/manage/settings` renderuje kartę
  blokady „Własny branding” + „Własny branding jest dostępny w planie Campus.” +
  „Zobacz plany”; nie ma `input[type=file]`, `input[type=color]`, „Wgraj logo” ani „Kolor
  marki”, a wcześniej wgrane logo nie jest nigdzie malowane (przełącznik pokazuje awatar
  `/api/v1/avatar/org/<id>`). Karta „Subskrypcja” pokazuje nazwę planu tenanta.
- Krok 2 — jako manager bez funkcji: `PUT /api/v1/organization/<id>` z
  `{"brandColor":"#ff0000"}` → **403** `{"success":false,"error":"FORBIDDEN"}`;
  `POST /api/v1/organization/<id>/logo` (multipart, prawdziwy PNG) → **403**
  `{"success":false,"error":"FORBIDDEN"}`. `organizations.brand_color` pozostaje `#00aa00`,
  `logo_url` bez zmian, a publiczny URL pliku nadal zwraca 200 — odrzucenie nie zmienia ani
  koloru, ani logo. `PUT` z samym `name` (bez pól brandingu) nadal zwraca 200, więc bramka
  dotyczy brandingu, nie całego edytora organizacji.
- Zgodność z oczekiwanym rezultatem: pełna (UI blokuje, API odrzuca 403, brak zmiany
  koloru/logo).

> **2026-11-25 (6d).** The „Subskrypcja” badge now names every layer of
> `/me/plan`'s union, so it reads „StudiQ Launch (organizacja) + StudiQ Free (plan
> osobisty)” before the upgrade and „StudiQ Hub (organizacja) + StudiQ Free (plan
> osobisty)” after it — the personal `free` layer is part of a manager's plan.
> The spec asserts the org layer as a substring of `[data-plan-union]`.
