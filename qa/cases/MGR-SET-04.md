# MGR-SET-04 — Kolor marki

- id: MGR-SET-04
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Ustawienia i branding (/manage/settings)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Plan z brandingiem.

## Steps

1. Wybierz kolor w polu „Kolor marki” i kliknij „Zapisz”.
2. Odśwież stronę.

## Expected result

- Toast „Kolor zaktualizowany”; wartość hex wyświetlona obok pola; po odświeżeniu zachowana (synchronizacja stanu z danymi organizacji).

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`manager@dev.local`, `pass`). Warunek
wstępny przypadku — plan z brandingiem — jest ustawiany **wewnątrz tenanta przypadku**
przez ten sam RPC, którego używa webhook płatności (`apply_org_plan`), a nie przez zmianę
globalnego katalogu planów czy planu innej organizacji:

```bash
bun scripts/qa-tenant.ts MGR-SET-04 --fresh
```

- `qa/tests/profiles.json` deklaruje `{ "profile": "content", "plan": "hub" }`, więc
  `--fresh` (i przebieg CI) seeduje profil `content` i przenosi **własną** organizację
  tenanta na plan Hub. `apply_org_plan` odświeża snapshot `org_role_features`, dzięki
  czemu rola `admin` dostaje `branding`; `/api/v1/features/me` zwraca tę funkcję, a
  `/manage/settings` pokazuje kontrolki logo i koloru marki zamiast karty blokady.
- Mapowanie starych skrótów: M1 → `users.manager` (admin organizacji). Przypadek jest
  wyłącznie managerski; T1/S1 nie są potrzebni, ale profil `content` ich tworzy.
- Klucz tenanta: `MGR-SET-04.md::MGR-SET-04#<run>::qa-shared` —
  `tenantKey('qa/cases/MGR-SET-04.md', 'MGR-SET-04#<run>', 'qa-shared')` + `tenantId`, ten
  sam schemat co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, więc każdy
  niezależny przebieg dostaje świeżą organizację; identyfikatory są deterministyczne w
  obrębie przebiegu (bez losowanych UUID).
- Świeży tenant nie ma zapisanego koloru (`brand_color = null`), dlatego spec czyści
  wyłącznie `brand_color` **swojej** organizacji (service-role) i zaczyna od stanu
  domyślnego pickera `#000000`. Dzięki temu przebieg jest powtarzalny bez reseedu.
- Wybór koloru w teście idzie przez prawdziwy `input[type=color]` (`fill`), a zapis przez
  przycisk „Zapisz” w tym samym wierszu; test czeka na `PUT
/api/v1/organization/<id>` i sprawdza `brand_color` w `GET /api/v1/organization/<id>`.
- Spec: `qa/tests/MGR/MGR-SET-04.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl`.
- Izolacja: test czyta i zapisuje wyłącznie `brand_color` swojej organizacji; nie dotyka
  flag funkcji, katalogu planów, ustawień admina, statystyk platformy ani wierszy
  singletonowych.

## Observed (ręczny przebieg, 2026-10-28, qa-env-3)

- `/manage/settings` na planie Hub pokazuje kartę „Profil uczelni” z sekcją „Logo” oraz
  „Kolor marki”: `input[type=color]`, obok niego etykieta z aktualną wartością hex i
  przycisk „Zapisz”. Karta blokady brandingu („Własny branding”) się nie pojawia.
- Świeża organizacja bez `brand_color` pokazuje domyślny `#000000` w polu i w etykiecie.
- Po wybraniu koloru etykieta od razu pokazuje jego hex (stan roboczy), a po „Zapisz”
  pojawia się toast „Kolor zaktualizowany” (sonner, 4 s). `PUT
/api/v1/organization/<id>` zwraca 200, a `GET` zwraca zapisany `brand_color`.
- Po odświeżeniu strony pole i etykieta nadal pokazują zapisany kolor; toast znika.
- Druga zmiana koloru również zapisuje się i jest widoczna po zapisie (regresja #272 —
  „każda druga zmiana wracała do zapisanej wartości”).
- Kolor jest wyłącznie kolorem organizacji: test nie zależy od globalnych ustawień
  admina, flag funkcji ani planu innej organizacji.
