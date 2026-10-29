# MGR-ROL-04 — Usuwanie ról – ograniczenia

- id: MGR-ROL-04
- priority: P1 krytyczny
- module: MGR – Panel managera organizacji (/manage)
- section: Role (/manage/roles)
- prereqs: role.builder (plan Hub); rola niestandardowa z członkiem + pusta rola niestandardowa
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Rola niestandardowa z członkiem i rola bez członków.

## Steps

1. Spróbuj usunąć rolę systemową.
2. Spróbuj usunąć rolę z przypisanym członkiem.
3. Usuń pustą rolę niestandardową.

## Expected result

- Systemowa: „Ról systemowych nie można usuwać”.
- Z członkami: „Usuń wszystkich członków z tej roli przed usunięciem”.
- Pusta niestandardowa: usunięta, toast „Rola usunięta”.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`manager@dev.local`, `pass`). Warunek
wstępny przypadku — kreator ról (`role.builder`) — jest ustawiany **wewnątrz tenanta
przypadku** przez ten sam RPC, którego używa webhook płatności (`apply_org_plan`), a nie
przez globalną flagę czy zmianę planu innej organizacji:

```bash
bun scripts/qa-tenant.ts MGR-ROL-04 --fresh
```

- `__tests__/qa/profiles/<CASE>.json` deklaruje `{ "profile": "content", "plan": "hub" }`, więc
  `--fresh` (i przebieg CI) seeduje profil `content` i przenosi **własną** organizację
  tenanta na plan Hub. Rola `admin` dostaje wtedy `role.builder` w snapshocie
  `org_role_features`, a `/api/v1/features/me` zwraca tę funkcję.
- Mapowanie skrótów z ręcznego seeda: M1 → `users.manager` (admin organizacji), T1 →
  `users.teacher`, S1 → `users.student`.
- Klucz tenanta: `MGR-ROL-04.md::MGR-ROL-04#<run>::qa-shared` —
  `tenantKey('qa/cases/MGR-ROL-04.md', 'MGR-ROL-04#<run>', 'qa-shared')` + `tenantId`, ten
  sam schemat co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, więc każdy
  niezależny przebieg dostaje świeżą organizację; identyfikatory są deterministyczne w
  obrębie przebiegu (bez losowych UUID).
- Stan wstępny z przypadku spec buduje w swoim tenancie przez API produktu:
  `POST /api/v1/organization/roles` tworzy „Asystent QA” (z członkiem) i „Pusta QA”
  (bez członków), a `PUT /api/v1/organization/members` przypisuje T1 do „Asystent QA”.
  Trzecia rola, „Anulowana QA”, powstaje tylko na potrzeby ścieżki anulowania.
- Spec: `__tests__/qa/MGR/MGR-ROL-04.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl`.
- Izolacja: test czyta i zapisuje wyłącznie role oraz członkostwa swojej organizacji; nie
  dotyka flag funkcji, katalogu planów (`plan_features` czyta tylko pośrednio przez RPC),
  ustawień admina, statystyk platformy ani wierszy singletonowych.

## Observed (ręczny przebieg, 2026-10-28, qa-env-4)

- Krok 1: dla ról systemowych `admin`, `teacher`, `member` wiersz ma plakietkę
  „Systemowa” i wyłącznie akcje „Uprawnienia roli …” / „Edytuj rolę …” — **brak
  przycisku usuwania**, więc menedżer nie może otworzyć dialogu usunięcia roli
  systemowej. Wymuszone `DELETE /api/v1/organization/roles/<id>` zwraca `403 FORBIDDEN`,
  a rola i jej członkowie zostają. Komunikat „Ról systemowych nie można usuwać” istnieje
  w i18n i jest mapowany na `FORBIDDEN`, ale przez UI jest nieosiągalny — to zamierzone
  zabezpieczenie (analogicznie do braku akcji usunięcia własnego członkostwa w
  MGR-MEM-04), nie usterka.
- Krok 2: „Asystent QA” z jednym członkiem ma akcję usuwania. Dialog „Usunąć rolę?” z
  opisem „Tej operacji nie można cofnąć…” → „Usuń” zwraca `409 CONFLICT`, zamyka dialog i
  pokazuje toast „Usuń wszystkich członków z tej roli przed usunięciem”; po `reload` rola
  nadal istnieje z licznikiem 1, a T1 zachowuje przypisanie.
- Krok 3: pusta rola niestandardowa → „Usuń” zwraca `200`, zamyka dialog i pokazuje toast
  „Rola usunięta”; wiersz znika od razu (lista jest przeładowywana) i po `reload`, a
  „Asystent QA” z członkiem pozostaje nietknięta.
- Anulowanie dialogu („Anuluj”) nie wysyła żadnego `DELETE`, nie pokazuje toastu i nie
  usuwa roli — również po `reload`.
