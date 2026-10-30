# MGR-SET-03 — Logo – niedozwolone pliki

- id: MGR-SET-03
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Ustawienia i branding (/manage/settings)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Plan z brandingiem.

## Steps

1. Spróbuj wgrać plik .txt, plik .svg i obraz > 5 MB.

## Expected result

- Dozwolone typy w selektorze: PNG, JPEG, GIF, WEBP. Niedozwolone/za duże pliki dają toast „Nie udało się zapisać” i nie zmieniają logo.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`manager@dev.local`, `pass`). Warunek
wstępny przypadku — plan z brandingiem — jest ustawiany **wewnątrz tenanta przypadku**
przez ten sam RPC, którego używa webhook płatności (`apply_org_plan`), a nie przez zmianę
globalnego katalogu planów czy planu innej organizacji:

```bash
bun scripts/qa-tenant.ts MGR-SET-03 --fresh
```

- `__tests__/qa/profiles/<CASE>.json` deklaruje `{ "profile": "content", "plan": "hub" }`, więc
  `--fresh` (i przebieg CI) seeduje profil `content` i przenosi **własną** organizację
  tenanta na plan Hub. `apply_org_plan` odświeża snapshot `org_role_features`, dzięki
  czemu rola `admin` dostaje `branding`; `/api/v1/features/me` zwraca tę funkcję, a
  `/manage/settings` pokazuje kontrolki logo i koloru marki zamiast karty blokady.
- Mapowanie starych skrótów: M1 → `users.manager` (admin organizacji). Przypadek jest
  wyłącznie managerski; T1/S1 nie są potrzebni, ale profil `content` ich tworzy.
- Klucz tenanta: `MGR-SET-03.md::MGR-SET-03#<run>::qa-shared` —
  `tenantKey('qa/cases/MGR-SET-03.md', 'MGR-SET-03#<run>', 'qa-shared')` + `tenantId`, ten
  sam schemat co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, więc każdy
  niezależny przebieg dostaje świeżą organizację; identyfikatory są deterministyczne w
  obrębie przebiegu (bez losowanych UUID).
- Świeży tenant nie ma logo (`logo_url = null`), dlatego spec najpierw wgrywa prawidłowy
  PNG 1×1 i dopiero na nim sprawdza „nie zmieniają logo”. Dzięki temu odrzucony upload,
  który wyczyściłby `logo_url`, zostałby wykryty, a nie ukryty przez pusty stan.
- Pliki użyte w kroku 1: `notes.txt` (`text/plain`), `logo.svg` (`image/svg+xml`) oraz
  `too-big.png` (6 MB, `image/png`). Wybór plików przez `setInputFiles` omija filtr
  `accept` selektora — tak samo jak przeciągnięcie pliku lub wybór „wszystkie pliki” —
  więc żądanie naprawdę dociera do serwera i jest tam walidowane.
- Spec: `__tests__/qa/MGR/MGR-SET-03.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl`.
- Izolacja: test czyta i zapisuje wyłącznie logo swojej organizacji; nie dotyka flag
  funkcji, katalogu planów, ustawień admina, statystyk platformy ani wierszy
  singletonowych.

## Observed (ręczny przebieg, 2026-10-28, qa-env-7)

- `/manage/settings` na planie Hub pokazuje kartę „Profil uczelni” z sekcją „Logo”
  („Brak logo” + przycisk „Wgraj logo”) oraz „Kolor marki”; karta blokady brandingu się
  nie pojawia.
- Ukryty `input[type=file]` ma `accept="image/png,image/jpeg,image/gif,image/webp"` —
  dokładnie cztery dozwolone typy z oczekiwanego rezultatu.
- Prawidłowy PNG: toast „Logo zaktualizowane”, podgląd 48×48 wskazujący na
  `org-logos/<orgId>/<uuid>.png`, logo pojawia się też w przełączniku organizacji;
  `GET /api/v1/organization/<id>` zwraca nowy `logo_url`.
- `notes.txt` (`text/plain`) → `422 UNPROCESSABLE_ENTITY`, toast „Nie udało się zapisać”,
  `logo_url` i podgląd bez zmian.
- `logo.svg` (`image/svg+xml`) → `422 UNPROCESSABLE_ENTITY`, toast „Nie udało się
  zapisać”, `logo_url` i podgląd bez zmian.
- `too-big.png` 6 MB (`image/png`) → `413 PAYLOAD_TOO_LARGE`, toast „Nie udało się
  zapisać”, `logo_url` i podgląd bez zmian. Limit bucketu `org-logos` to 5 MB, więc plik
  „> 5 MB” jest odrzucany przed zapisem do storage.
- Po odświeżeniu strony logo z prawidłowego uploadu nadal jest widoczne; odrzucone pliki
  nie zostawiły po sobie śladu.
