# MGR-SET-05 — Utrata brandingu po obniżeniu planu

- id: MGR-SET-05
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Ustawienia i branding (/manage/settings)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Organizacja z wgranym logo na planie Hub.

## Steps

1. W panelu admina zmień plan organizacji / wyłącz funkcję branding (ADM-OVR lub ADM-PLN).
2. Odśwież /manage.

## Expected result

- Logo przestaje być wyświetlane w przełączniku (funkcja bramkowana planem) – nawet jeśli plik pozostaje w bazie.
- W Ustawieniach pojawia się karta blokady.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`manager@dev.local`, `pass`). Warunek
wstępny przypadku — organizacja z wgranym logo na planie Hub — jest ustawiany **wewnątrz
tenanta przypadku** przez ten sam RPC, którego używa webhook płatności (`apply_org_plan`),
a nie przez zmianę globalnego katalogu planów czy planu innej organizacji:

```bash
bun scripts/qa-tenant.ts MGR-SET-05 --fresh
```

- `__tests__/qa/profiles/<CASE>.json` deklaruje `{ "profile": "content", "plan": "hub" }`, więc
  `--fresh` (i przebieg CI) seeduje profil `content` i przenosi **własną** organizację
  tenanta na plan Hub. `apply_org_plan` odświeża snapshot `org_role_features`, dzięki
  czemu rola `admin` dostaje `branding`; `/api/v1/features/me` zwraca tę funkcję, a
  `/manage/settings` pokazuje kontrolki logo i koloru marki.
- Mapowanie starych skrótów: M1 → `users.manager` (admin organizacji). Przypadek jest
  wyłącznie managerski; T1/S1 nie są potrzebni, ale profil `content` ich tworzy.
- Klucz tenanta: `MGR-SET-05.md::MGR-SET-05#<run>::qa-shared` —
  `tenantKey('qa/cases/MGR-SET-05.md', 'MGR-SET-05#<run>', 'qa-shared')` + `tenantId`, ten
  sam schemat co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, więc każdy
  niezależny przebieg dostaje świeżą organizację; identyfikatory są deterministyczne w
  obrębie przebiegu (bez losowanych UUID).
- Krok 1 przypadku („w panelu admina zmień plan organizacji / wyłącz funkcję branding"):
  w tym buildzie panel admina (`apps/admin`) **nie ma** edytora planu organizacji (tylko
  odczyt listy organizacji), a ADM-OVR / ADM-PLN operują na wspólnych wierszach
  (`user_feature_overrides`, `plan_features`) i katalogu planów, których test suite nie
  może zmieniać. Odpowiednikiem tej czynności jest więc zmiana uprawnienia **tej samej**
  organizacji przez webhook symulowanej płatności (`POST /api/v1/stripe/webhook` →
  `MockStripeService.handleWebhook` → `apply_org_plan`) — dokładnie ta sama ścieżka, przez
  którą przechodzi realna zmiana planu. Obniżenie do `launch` (darmowy plan managera bez
  funkcji `branding`) odbiera branding roli `admin`; na końcu spec wraca do `hub` w obrębie
  tego samego tenanta, żeby udowodnić, że plik logo nie zniknął, a jedynie wyświetlanie
  jest bramkowane planem.
- Izolacja: test czyta i zapisuje wyłącznie logo, plan oraz historię płatności swojej
  organizacji; nie dotyka flag funkcji, katalogu planów, ustawień admina, statystyk
  platformy ani wierszy singletonowych.

## Observed (ręczny przebieg, 2026-10-28, qa-env-7)

- Hub + wgrany PNG: przełącznik organizacji pokazuje logo (`img` 32×32, `alt=""`,
  `src` = publiczny URL z `org-logos/…`), `/manage/settings` pokazuje podgląd 48×48,
  przycisk „Wgraj logo" i „Kolor marki"; `/api/v1/features/me` zawiera `branding`.
- Po obniżeniu do `launch` (webhook 200): `/api/v1/features/me` nie zawiera już `branding`,
  `/api/v1/me/plan` zwraca `launch` / „StudiQ Launch", `organizations.logo_url` pozostaje
  bez zmian, a publiczny URL pliku nadal zwraca 200.
- Po odświeżeniu `/manage`: przełącznik (zarówno trigger, jak i pozycja w rozwijanym menu)
  pokazuje awatar `/api/v1/avatar/org/<id>` zamiast logo; logo nie jest renderowane nigdzie
  na stronie.
- `/manage/settings`: karta blokady „Własny branding" z opisem „Ulepsz plan, aby uzyskać
  dostęp do własnego brandingu" i przyciskiem „Zobacz plany"; brak `input[type=file]`,
  brak „Wgraj logo", brak „Kolor marki" i brak podglądu logo. Karta subskrypcji pokazuje
  „StudiQ Launch".
- Po powrocie na Hub (webhook `hub`): logo wraca w przełączniku i jako podgląd 48×48
  w Ustawieniach, bez ponownego wgrywania — plik i `logo_url` przetrwały obniżenie planu.
