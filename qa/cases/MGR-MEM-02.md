# MGR-MEM-02 — Zmiana roli członka

- id: MGR-MEM-02
- priority: P1 krytyczny
- module: MGR – Panel managera organizacji (/manage)
- section: Członkowie (/manage/members)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

M1, WSB Merito; członek S1 (rola Member).

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`manager@dev.local`, `pass`). Przypadek
potrzebuje organizacji z managerem (`admin`) i członkiem w roli `member`, którego rolę
można zmienić — dokładnie to daje tenant `content`:

```bash
bun scripts/qa-tenant.ts MGR-MEM-02 --fresh
```

- Klucz tenanta: `MGR-MEM-02.md::MGR-MEM-02#<run>::qa-shared` —
  `tenantKey('qa/cases/MGR-MEM-02.md', 'MGR-MEM-02#<run>', 'qa-shared')` + `tenantId`, ten
  sam schemat co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, więc każde
  niezależne uruchomienie dostaje świeżą organizację; identyfikatory są deterministyczne
  w obrębie przebiegu (bez losowych UUID).
- Organizacja: `qa-mgr-mem-02-<suffix>` (plan `launch`), grupa domyślna `G1`.
- Członkowie: manager (`admin`, rola org `admin`), nauczyciel (`teacher`, rola org
  `member`), student (`student`, rola org `member`) — student jest „S1” z przypadku.
- Konto managera: `seed-manager-<hash>@dev.local` / `Seed4Test!`,
  `app_metadata.account_type = manager`.
- Worker QA-suite seeduje **wspólną** bazę (`http://localhost:54421`); `scripts/qa-tenant.ts`
  bierze URL z `qa/env.json`, a klucz service role z `apps/web/.env`.
- Spec: `__tests__/qa/MGR/MGR-MEM-02.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl` (kopie w przypadku są polskie).
- Izolacja: test czyta i zmienia wyłącznie wiersz `org_members` swojego studenta w swojej
  organizacji; nie dotyka flag funkcji, katalogu planów, statystyk platformy ani wierszy
  singletonowych.

## Steps

1. Wybierz akcję zmiany roli przy S1 i ustaw „Teacher”.
2. W oknie „Zmienić rolę?” potwierdź.
3. Odśwież stronę, a następnie przywróć rolę „Member”.

## Expected result

- Toast „Rola zaktualizowana”; rola w tabeli zmienia się.
- Zanotuj treść okna potwierdzenia – szablon „Czy na pewno chcesz zmienić {role}?” może wyświetlać niekompletne zdanie (uwaga językowa).
- Dostępne role to role organizacji (Admin / Teacher / Member + role niestandardowe).

## Observed during the suite walk (qa-env-8, shared app 3010 / DB 54421)

- `/manage/members` renderuje tabelę „Członek / Rola / Grupy / Dołączył / Akcje”;
  wiersz managera pokazuje `(ty)` zamiast akcji, więc własnej roli nie da się zmienić
  z listy. Wiersze nauczyciela i studenta mają listę roli (`button[role="combobox"]`),
  „Zarządzaj grupami” i usuwanie.
- Lista roli w wierszu zawiera **role organizacji** z
  `GET /api/v1/organization/roles` (kolejność `order('name')`): `admin` → „Admin”,
  `member` → „Student”, `teacher` → „Teacher”. Rola `member` jest w UI wyświetlana jako
  **„Student”** (to samo `display_name` co przy zaproszeniach, patrz ONB-10); kopia
  przypadku „Member” to nazwa roli, nie etykieta. Rola niestandardowa trafiłaby na tę
  listę tym samym mapowaniem, ale plan `launch` nie ma funkcji kreatora ról, więc tenant
  ma wyłącznie role systemowe.
- Krok 1 — wybór „Teacher” w wierszu studenta otwiera okno `role="alertdialog"`:
  tytuł **„Zmienić rolę?”**, opis **„Czy na pewno chcesz zmienić Teacher?”**, przyciski
  „Anuluj” / „Potwierdź”. Zdanie jest niekompletne („zmienić Teacher” zamiast „zmienić
  rolę na Teacher”) — to uwaga językowa P3, którą opisuje sam przypadek; zachowanie
  (potwierdzenie przed zapisem) jest poprawne. „Anuluj” zamyka okno i **nie** wysyła
  żądania — rola pozostaje bez zmian.
- Krok 2 — „Potwierdź” wysyła `PUT /api/v1/organization/members`
  `{"targetUserId":"<student>","newOrgRoleId":"<teacher role id>"}` → **200**
  `{"success":true,"data":{"success":true}}`, pojawia się toast **„Rola zaktualizowana”**,
  a komórka roli (`[data-testid="member-role"]`) zmienia się na „Teacher”.
- Krok 3 — po odświeżeniu rola nadal „Teacher” (`GET /api/v1/organization/members` →
  `orgRoleName: "teacher"`). Przywrócenie „Student” tą samą ścieżką daje toast
  „Rola zaktualizowana” i po odświeżeniu `orgRoleName: "member"`.
- Zabezpieczenia tego samego endpointu: zmiana **własnej** roli przez managera →
  **403** `{"success":false,"error":"FORBIDDEN"}` (widoczne też w UI jako `(ty)` bez
  listy roli); `newOrgRoleId` spoza organizacji (losowy UUID) → **403** `FORBIDDEN`,
  rola członka pozostaje bez zmian.
