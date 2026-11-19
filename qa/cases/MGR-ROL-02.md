# MGR-ROL-02 — Tworzenie i edycja roli – uprawnienie org.role.manage

- id: MGR-ROL-02
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Role (/manage/roles)
- prereqs: uprawnienie org.role.manage (rola org admin); plan Hub z BIL-04 jako kontekst
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Włącz role.builder dla organizacji (override w adminie lub plan Hub: BIL-04).

> **Stan po fazie 2a-2 (ADR-0015 §4.4).** Bramką zapisu roli jest uprawnienie
> `org.role.manage`, a nie funkcja planu `role.builder`. Rolę zapisuje członek,
> którego rola organizacji ma to uprawnienie — rola systemowa `admin` ma je na
> każdym planie. Tenant pozostaje na Hubie, bo tak opisuje go dokument źródłowy,
> ale plan nie jest już warunkiem zapisu.

## Prerequisite context (verbatim, legacy seed)

### BIL-04 — Zakup planu organizacji przez managera

_Warunek wstępny: manager@dev.local, organizacja WSB Merito (Launch)._

1. Wejdź na /pricing?audience=organization i wybierz „Hub” → zakup (checkout z kartą testową).
2. Po zakupie sprawdź /manage/settings (branding) i /manage/roles.

Expected:

- Zakup przechodzi (komunikaty jak w BIL-03).
- WERYFIKUJ I ZGŁOŚ: z kodu wynika, że symulowany webhook zmienia wyłącznie plan OSOBISTY użytkownika (profiles.personal_plan_key), a NIE plan organizacji. Oczekiwane (zgodnie ze specyfikacją): organizacja przechodzi na Hub i odblokowuje branding oraz kreator ról. Jeśli po zakupie organizacja nadal ma Launch (karta blokady brandingu widoczna), zgłoś jako defekt funkcjonalny.

## Steps

1. Utwórz rolę „Asystent”.
2. Edytuj jej nazwę i opis.

## Expected result

- Toasty „Rola utworzona”, „Rola zaktualizowana”; typ „Niestandardowa”.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`manager@dev.local`, `pass`) ani nie
przechodzi ścieżki zakupu z BIL-04. Warunek wstępny przypadku — możliwość zapisu roli —
spełnia rola systemowa `admin` tenanta, która ma `org.role.manage`; plan Hub jest
ustawiany **wewnątrz tenanta przypadku** przez ten sam RPC, którego używa webhook
płatności (`apply_org_plan`), bo tak opisuje przypadek, a nie przez globalną flagę czy
zmianę planu innej organizacji:

```bash
bun scripts/qa-tenant.ts MGR-ROL-02 --fresh
```

- `__tests__/qa/profiles/<CASE>.json` deklaruje `{ "profile": "content", "plan": "hub" }`, więc
  `--fresh` (i przebieg CI) seeduje profil `content` i przenosi **własną** organizację
  tenanta na plan Hub. Zapisu roli nie warunkuje już plan: `/api/v1/permissions/me`
  administratora zwraca `org.role.manage` z roli `admin`.
- Mapowanie starych skrótów: M1 → `users.manager` (admin organizacji), T1 →
  `users.teacher`, S1 → `users.student`; przypadku nie dotyczy T2.
- Klucz tenanta: `MGR-ROL-02.md::MGR-ROL-02#<run>::qa-shared` —
  `tenantKey('qa/cases/MGR-ROL-02.md', 'MGR-ROL-02#<run>', 'qa-shared')` + `tenantId`, ten
  sam schemat co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, więc każdy
  niezależny przebieg dostaje świeżą organizację; identyfikatory są deterministyczne w
  obrębie przebiegu (bez losowych UUID).
- Świeży tenant ma wyłącznie role systemowe `admin`, `teacher`, `member` — spec wymaga
  braku ról niestandardowych, więc „Asystent” zawsze powstaje w tym przebiegu.
- Spec: `__tests__/qa/MGR/MGR-ROL-02.spec.ts`, projekt `__tests__/qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl`.
- Izolacja: test czyta i zapisuje wyłącznie role swojej organizacji; nie dotyka flag
  funkcji, katalogu planów (`plan_entitlements` czyta tylko pośrednio przez RPC), ustawień
  admina, statystyk platformy ani wierszy singletonowych. Ścieżka zakupu z BIL-04 jest
  osobnym przypadkiem i nie jest tu wykonywana.

## Observed (ręczny przebieg, 2026-10-28, qa-env-7)

- `/manage/roles` na planie Hub pokazuje przycisk „Nowa rola”, kolumnę „Akcje” i listę
  trzech ról systemowych; karta blokady „Kreator ról nie jest dostępny w Twoim planie”
  się nie pojawia.
- Formularz „Utwórz rolę” ma pola „Nazwa roli” i „Opis (opcjonalny)” oraz przyciski
  „Anuluj” / „Utwórz”. Po zapisie: toast „Rola utworzona”, wiersz „Asystent” z plakietką
  „Niestandardowa”, 0 członków, 0 uprawnień.
- Formularz „Edytuj rolę” jest wstępnie wypełniony nazwą; po zmianie nazwy i opisu:
  toast „Rola zaktualizowana”, wiersz pokazuje nową nazwę i opis pod nią, a stara nazwa
  znika (zmiana w miejscu, nie duplikat).
- API `GET /api/v1/organization/roles` po edycji zwraca ten sam `id`, nowe `name` oraz
  zsynchronizowane `displayName`, `description`, `isSystem: false`; po `reload` lista
  pokazuje stan z bazy.
- Role systemowe `admin`, `teacher`, `member` pozostają „Systemowa” i nie zmieniają nazw.
