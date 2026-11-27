# MGR-SET-05 — Utrata brandingu po obniżeniu planu

- id: MGR-SET-05
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Ustawienia i branding (/manage/settings)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Amendment (2026-11-27, organization ladder)

`branding` is the Campus feature, so Hub and Launch do not carry it. The case still runs the real
Hub → Launch → Hub webhook path: the lock card and the unpainted stored logo are present on both
tiers, the stored `logo_url`/`brand_color` never change, and re-buying Hub does not restore the
controls because Campus, not Hub, is the tier that grants the feature.

## Prerequisite (verbatim)

Organizacja z wgranym logo na planie Hub.

## Steps

1. Obniż plan organizacji do Launch przez symulowany webhook płatności (`POST /api/v1/stripe/webhook` → `change_org_plan`), aby wyłączyć funkcję branding.
2. Odśwież /manage.

## Expected result

- Logo przestaje być wyświetlane w przełączniku (funkcja bramkowana planem) – nawet jeśli plik pozostaje w bazie.
- W Ustawieniach pojawia się karta blokady.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`manager@dev.local`, `pass`). Warunek
wstępny przypadku — organizacja z wgranym logo na planie Hub — jest ustawiany **wewnątrz
tenanta przypadku** przez ten sam RPC, którego używa webhook płatności (`change_org_plan`),
a nie przez zmianę globalnego katalogu planów czy planu innej organizacji:

```bash
bun scripts/qa-tenant.ts MGR-SET-05 --fresh
```

- `__tests__/qa/profiles/<CASE>.json` deklaruje `{ "profile": "content", "plan": "hub" }`, więc
  `--fresh` (i przebieg CI) seeduje profil `content` i przenosi **własną** organizację
  tenanta na plan Hub. Drabinka jest kumulatywna, ale `branding` ma tylko Campus: rola
  `admin` z profilem `all` dostaje przecięcie z pułapem Hubu, więc
  `/api/v1/me/entitlements` nie zawiera `branding`, a `/manage/settings` pokazuje kartę
  blokady. Wartości logo i koloru, które zostawiłaby organizacja na Campusie, spec zapisuje
  bezpośrednio w wierszu **swojej** organizacji (fixture), bo bramka ukrywa uploader.
- Mapowanie starych skrótów: M1 → `users.manager` (admin organizacji). Przypadek jest
  wyłącznie managerski; T1/S1 nie są potrzebni, ale profil `content` ich tworzy.
- Klucz tenanta: `MGR-SET-05.md::MGR-SET-05#<run>::qa-shared` —
  `tenantKey('qa/cases/MGR-SET-05.md', 'MGR-SET-05#<run>', 'qa-shared')` + `tenantId`, ten
  sam schemat co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, więc każdy
  niezależny przebieg dostaje świeżą organizację; identyfikatory są deterministyczne w
  obrębie przebiegu (bez losowanych UUID).
- Krok 1 przypadku (zmiana planu organizacji): zmiana uprawnienia **tej samej**
  organizacji przez webhook symulowanej płatności (`POST /api/v1/stripe/webhook` →
  `MockStripeService.handleWebhook` → `change_org_plan`) — dokładnie ta sama ścieżka, przez
  którą przechodzi realna zmiana planu. Obniżenie do `launch` nie zmienia bramki: Hub i
  Launch nie mają `branding` (ma je tylko Campus), więc karta blokady zostaje na obu
  planach. Na końcu spec wraca do `hub` w obrębie
  tego samego tenanta, żeby udowodnić, że plik logo nie zniknął, a wyświetlanie
  jest bramkowane planem.
- Izolacja: test czyta i zapisuje wyłącznie logo, plan oraz historię płatności swojej
  organizacji; nie dotyka flag funkcji, katalogu planów, ustawień admina, statystyk
  platformy ani wierszy singletonowych.

## Observed (ręczny przebieg, 2026-10-28, qa-env-7; plan names from the pre-#1493 matrix — Campus carries branding today)

- Plan z brandingiem (wtedy Hub; dziś **Campus**) + wgrany PNG: przełącznik organizacji pokazuje
  logo (`img` 32×32, `alt=""`,
  `src` = publiczny URL z `org-logos/…`), `/manage/settings` pokazuje podgląd 48×48,
  przycisk „Wgraj logo" i „Kolor marki"; `/api/v1/me/entitlements` zawiera `branding`.
- Na planie bez brandingu (wtedy `launch`; dziś **Hub**, stan tego tenanta):
  `/api/v1/me/entitlements` nie zawiera `branding`,
  `/api/v1/me/plan` zwraca plan tenanta, `organizations.logo_url` pozostaje
  bez zmian, a publiczny URL pliku nadal zwraca 200.
- Po odświeżeniu `/manage`: przełącznik (zarówno trigger, jak i pozycja w rozwijanym menu)
  pokazuje awatar `/api/v1/avatar/org/<id>` zamiast logo; logo nie jest renderowane nigdzie
  na stronie.
- `/manage/settings`: karta blokady „Własny branding" z opisem „Własny branding jest dostępny
  w planie Campus." i przyciskiem „Zobacz plany"; brak `input[type=file]`,
  brak „Wgraj logo", brak „Kolor marki" i brak podglądu logo. Karta subskrypcji pokazuje
  plan tenanta.
- Po powrocie na Hub (webhook `hub`): logo wraca w przełączniku i jako podgląd 48×48
  w Ustawieniach, bez ponownego wgrywania — plik i `logo_url` przetrwały obniżenie planu.

> **2026-11-25 (6d).** The subscription card's badge now names every layer of
> `/me/plan`'s union, so it reads „StudiQ Launch (organizacja) + StudiQ Free
> (plan osobisty)” — the personal `free` layer is part of a manager's plan. The
> earlier walks' „StudiQ Launch” is the org layer of that label; the spec asserts
> it as a substring of `[data-plan-union]`.
