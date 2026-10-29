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

- `qa/tests/profiles/LIM-05.json` deklaruje `{ "profile": "content", "plan": "hub" }`. Profil
  `content` tworzy organizację `qa-lim-05-<suffix>` z managerem (`admin`), nauczycielem i
  studentem; `plan: "hub"` przenosi **tę jedną** organizację na Hub przez `apply_org_plan`
  — ten sam RPC, który wywołuje webhook płatności — dzięki czemu rola `admin` ma funkcję
  `branding`. To odpowiednik warunku „organizacja z brandingiem”, od którego zaczynają się
  MGR-SET-02 i MGR-SET-05 (MGR-SET-01 to stan Launch, osiągany w kroku 1 poniżej).
- Klucz tenanta: `LIM-05.md::LIM-05#<run>::qa-shared` —
  `tenantKey('qa/cases/LIM-05.md', 'LIM-05#<run>', 'qa-shared')` + `tenantId` dla org, grup i
  użytkowników, ten sam schemat co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, więc
  każde niezależne uruchomienie dostaje świeżą organizację; identyfikatory są deterministyczne
  w obrębie przebiegu (bez losowanych UUID). Spec czyta tenant przez `loadTenant('LIM-05')`.
- Krok 1 przypadku („Wykonaj MGR-SET-01, MGR-SET-02, MGR-SET-05”) jest odtworzony w jednym
  tenancie: Hub → wgranie logo i ustawienie koloru marki (MGR-SET-02) → obniżenie planu do
  `launch` webhookiem symulowanej płatności (`POST /api/v1/stripe/webhook` →
  `MockStripeService.handleWebhook` → `apply_org_plan`), czyli dokładnie ścieżką zmiany planu,
  której używa MGR-SET-05. Panel admina w tym buildzie nie ma edytora planu organizacji
  (tylko odczyt listy), a ADM-OVR / ADM-PLN operują na wspólnych wierszach, których suite nie
  może zmieniać. Po asercjach spec wraca do `hub` w obrębie tego samego tenanta, żeby kolejny
  przebieg (retry CI na tym samym tenancie) zaczynał od warunku wstępnego.
- Izolacja: test czyta i zapisuje wyłącznie logo, kolor marki i plan **swojej** organizacji;
  nie dotyka flag funkcji, katalogu planów, ustawień admina, statystyk platformy ani wierszy
  singletonowych, ani innego tenanta.

## Observed during the suite walk (qa-env-2, shared app 3010 / DB 54421, 2026-10-29)

- Hub (`plan: hub`, `/api/v1/features/me` zawiera `branding`): `/manage/settings` pokazuje
  „Brak logo” / „Wgraj logo” (ukryty `input[type=file]`), „Kolor marki” z `input[type=color]`
  i przyciskiem „Zapisz”. Wgranie PNG 1×1 (`POST …/logo`) zwraca 200 i zapisuje
  `organizations.logo_url` pod `org-logos/<org-id>/…png`; zapis koloru (`PUT` z
  `brandColor`) zwraca 200 i zapisuje `#00aa00`; po odświeżeniu podgląd logo ma 48×48, a pole
  koloru pokazuje zapisaną wartość.
- Po obniżeniu do `launch` (webhook 200): `/api/v1/features/me` nie zawiera już `branding`,
  `/api/v1/me/plan` zwraca `launch` / „StudiQ Launch”. `/manage/settings` renderuje kartę
  blokady „Własny branding” + „Ulepsz plan, aby uzyskać dostęp do własnego brandingu” +
  „Zobacz plany”; nie ma `input[type=file]`, `input[type=color]`, „Wgraj logo” ani „Kolor
  marki”, a wcześniej wgrane logo nie jest nigdzie malowane (przełącznik pokazuje awatar
  `/api/v1/avatar/org/<id>`). Karta „Subskrypcja” pokazuje „StudiQ Launch”.
- Krok 2 — jako manager bez funkcji: `PUT /api/v1/organization/<id>` z
  `{"brandColor":"#ff0000"}` → **403** `{"success":false,"error":"FORBIDDEN"}`;
  `POST /api/v1/organization/<id>/logo` (multipart, prawdziwy PNG) → **403**
  `{"success":false,"error":"FORBIDDEN"}`. `organizations.brand_color` pozostaje `#00aa00`,
  `logo_url` bez zmian, a publiczny URL pliku nadal zwraca 200 — odrzucenie nie zmienia ani
  koloru, ani logo. `PUT` z samym `name` (bez pól brandingu) nadal zwraca 200, więc bramka
  dotyczy brandingu, nie całego edytora organizacji.
- Zgodność z oczekiwanym rezultatem: pełna (UI blokuje, API odrzuca 403, brak zmiany
  koloru/logo).
