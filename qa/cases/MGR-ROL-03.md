# MGR-ROL-03 — Edytor uprawnień roli

- id: MGR-ROL-03
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Role (/manage/roles)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Rola niestandardowa.

## Seed (tenant model)

Automatyzacja nie używa kont z ręcznego seeda (`manager@dev.local`, `pass`). Przypadek
dostaje własny tenant z rolą niestandardową, jej użytkownikiem i treściami, na których
sprawdzane są zakresy:

```bash
bunx playwright test -c qa/playwright.qa.config.ts \
  __tests__/qa/MGR/MGR-ROL-03.spec.ts --workers=1
```

Spec seeduje wszystko sam przez `seedTenantGraph()` (`__tests__/helpers/tenant-seed.ts`),
więc nie wymaga wcześniejszego uruchomienia `scripts/qa-tenant.ts`.

- Klucz tenanta: `MGR-ROL-03.md::MGR-ROL-03 role permission editor scopes::qa-shared::<run>` —
  `tenantKey('qa/cases/MGR-ROL-03.md', <tytuł>, 'qa-shared')` + `tenantId`, ten sam
  schemat co fixture'y e2e. Domyślnie każdy przebieg dostaje świeży sufiks, więc ma
  własną organizację, rolę, konta i treści; `QA_RUN_SUFFIX` utrwala przebieg.
- Organizacja `qa-mgr-rol03-<hash>` z grupą `G1`; konta `seed-manager-<hash>@dev.local`
  (admin) i `seed-student-<hash>@dev.local` / `Seed4Test!` (użytkownik roli niestandardowej).
- Rola niestandardowa `content-reader` (`is_system = false`, 0 uprawnień na starcie) —
  warunek wstępny przypadku. Użytkownik z tą rolą jest członkiem organizacji i grupy `G1`.
- Edycja uprawnień roli to funkcja `role.builder` z planu Hub+, a plan Launch celowo jej
  nie ma. Spec przenosi **własną** organizację na plan `hub` przez produktowe
  `apply_org_plan()` — katalog planów, flagi funkcji i inne organizacje pozostają nietknięte.
- Treści per zakres (każda rodzina: talia/fiszki, temat, bank pytań/pytania):
  - `own` — utworzone przez użytkownika roli,
  - `group` — utworzone przez admina i udostępnione grupie `G1`,
  - `org` — utworzone przez admina w organizacji, bez udostępnienia grupie.
- Spec: `__tests__/qa/MGR/MGR-ROL-03.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl` (kopie interfejsu w przypadku są polskie).
- Izolacja: test edytuje wyłącznie role i treści własnego tenanta i czyta listy treści
  własnej organizacji. Nie dotyka innego tenanta, ustawień admina, flag funkcji, planów
  (poza planem własnej organizacji), statystyk platformy ani wierszy singletonowych.

## Steps

1. Otwórz edycję uprawnień roli.
2. Dla sekcji Fiszki, Talie, Tematy, Banki pytań, Pytania ustaw zakres: Własne / Grupa / Organizacja.
3. Kliknij „Zapisz uprawnienia”.
4. Zaloguj się jako użytkownik z tą rolą i sprawdź dostęp do treści.

## Expected result

- Toast „Uprawnienia zaktualizowane”.
- Zakres „Własne” → widzi tylko swoje; „Grupa” → treści grupy; „Organizacja” → treści całej organizacji.

## Observations (walk 2026-10-28, shared app :3010, worker qa-env-2)

- `/manage/roles` na planie Hub pokazuje listę rol systemowych (`admin`, `member`,
  `teacher`) i rolę niestandardową z badge „Niestandardowa”, licznikiem członków i
  licznikiem uprawnień („0 uprawnień” przed edycją). Kolumna „Akcje” ma trzy przyciski:
  „Uprawnienia roli <nazwa>”, „Edytuj rolę <nazwa>”, „Usuń rolę <nazwa>”.
- Edytor to dialog „Edytuj uprawnienia: <nazwa>” z pięcioma sekcjami (Fiszki, Talie,
  Tematy, Banki pytań, Pytania). Każda sekcja ma cztery wiersze (Read/Create/Update/Delete)
  i trzy radio-przyciski: Własne / Grupa / Organizacja — razem 20 wierszy i 60 opcji.
- „Zapisz uprawnienia” pokazuje toast „Uprawnienia zaktualizowane” (sonner), zamyka
  dialog i odświeża licznik na liście („20 uprawnień”). Ponowne otwarcie edytora pokazuje
  zapisane zakresy jako zaznaczone; `GET /api/v1/organization/roles/<id>` zwraca dokładnie
  20 wierszy uprawnień z wybranym zakresem.
- Zakresy działają na liście treści i w API stron (`/api/v1/flashcards/decks`,
  `/api/v1/flashcards`, `/api/v1/flashcards/topics`, `/api/v1/questions/banks`,
  `/api/v1/questions`), dla wszystkich pięciu sekcji:
  - „Własne” → wyłącznie wiersze utworzone przez użytkownika (1),
  - „Grupa” → własne + udostępnione grupie (2), bez treści tylko-organizacyjnych,
  - „Organizacja” → wszystkie wiersze organizacji (3).
- Kolejne zapisy zastępują poprzedni zakres (Własne → Grupa → Organizacja) i od razu
  zmieniają to, co widzi użytkownik — uprawnienia nie są migawką z chwili zapisu.
- Użytkownik roli niestandardowej ma `features/me` dziedziczone z planu organizacji
  (rola bez wierszy `org_role_features`), więc strony `/app/*` renderują się normalnie;
  `GET /api/v1/organization/groups` zwraca mu 403 (brak `member.manage`), co nie
  wpływa na listy treści.
