# MGR-SET-01 — Branding zablokowany na planie Launch

- id: MGR-SET-01
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Ustawienia i branding (/manage/settings)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

M1, WSB Merito (Launch – bez funkcji branding).

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`manager@dev.local`, `pass`). Wymaganie
„M1, WSB Merito (Launch)” sprowadza się do managera własnej organizacji na planie
**Launch** — dokładnie to daje tenant `content`:

```bash
bun scripts/qa-tenant.ts MGR-SET-01 --fresh
```

- Klucz tenanta: `MGR-SET-01.md::MGR-SET-01#<run>::qa-shared` —
  `tenantKey('qa/cases/MGR-SET-01.md', 'MGR-SET-01#<run>', 'qa-shared')` + `tenantId`, ten
  sam schemat co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, więc każde
  niezależne uruchomienie dostaje świeżą organizację; identyfikatory są deterministyczne
  w obrębie przebiegu (bez losowych UUID). Spec czyta tenant z `qa/.tenants/MGR-SET-01.json`
  (`loadTenant`), tak jak pozostałe przypadki MGR.
- Organizacja: `qa-mgr-set-01-<suffix>`, tworzona przez trigger na planie `launch`
  (`organizations.plan`); globalny katalog planów, flagi funkcji i wiersze singletonowe
  są tylko czytane.
- Członkowie: manager (rola org `admin`), nauczyciel i student (rola org `member`) —
  przypadek używa wyłącznie managera.
- Konto managera: `seed-manager-<hash>@dev.local` / `Seed4Test!`,
  `app_metadata.account_type = manager`.
- Spec: `__tests__/qa/MGR/MGR-SET-01.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl` (kopie w przypadku są polskie).
- Izolacja: test czyta i zmienia wyłącznie własną organizację (i tylko ją próbuje
  zmienić — zapisy brandingu są odrzucane); nie dotyka planów, flag, statystyk ani
  innego tenanta.

## Steps

1. W sekcji Logo sprawdź kartę blokady.
2. Kliknij „Zobacz plany”.

## Expected result

- Zamiast uploadu widoczna karta „Własny branding – Ulepsz plan, aby uzyskać dostęp do własnego brandingu”; brak pola koloru marki.
- Przycisk prowadzi do /pricing.

## Observed during the suite walk (qa-env-8, shared app 3010 / DB 54421)

- `/manage/settings` („Zarządzanie Uczelnią → Ustawienia”, nagłówek „Ustawienia”) ma dwie
  karty: „Profil uczelni” (Nazwa + „Tylko do odczytu”, Utworzono, Logo) i „Subskrypcja”
  (badge „StudiQ Launch”, „Zarządzane przez administratorów systemowych”).
- Krok 1 — w sekcji „Logo” zamiast uploadu renderuje się karta z ikoną zamka:
  **„Własny branding”** / **„Ulepsz plan, aby uzyskać dostęp do własnego brandingu”** oraz
  przycisk **„Zobacz plany”**. Nie ma przycisku „Wgraj logo”, napisu „Brak logo”, etykiety
  „Kolor marki”, żadnego `input[type=file]` ani `input[type=color]`. Profil organizacji
  (nazwa, data utworzenia) pozostaje widoczny — blokada dotyczy tylko brandingu.
- Krok 2 — „Zobacz plany” prowadzi dokładnie do **`/pricing`** („Wybierz Swój Plan”) z
  trzema kartami typów planów; karta „Organizacja” prowadzi do `/pricing/org`, gdzie
  „Obecny Plan” to „StudiQ Launch”, a plany **Hub** i **Campus** wymieniają funkcję
  „Własny branding” (Launch i Team — nie). Ścieżka ulepszenia, o której mówi karta, istnieje.
- Ta sama sesja potwierdza bramkę po stronie API: `GET /api/v1/features/me` nie zawiera
  `branding`, `GET /api/v1/me/plan` zwraca `launch` bez `branding`,
  `PUT /api/v1/organization/<id>` z `{"brandColor":"#123456"}` → **403**
  `{"success":false,"error":"FORBIDDEN"}`, a `POST /api/v1/organization/<id>/logo`
  (multipart PNG) → **403** `FORBIDDEN`. `organizations.brand_color` i `logo_url`
  pozostają `null`.
- Zgodność z oczekiwanym rezultatem: pełna (karta blokady zamiast uploadu, brak pola
  koloru marki, przycisk → /pricing).
