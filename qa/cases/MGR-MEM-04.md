# MGR-MEM-04 — Usunięcie członka z organizacji

- id: MGR-MEM-04
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Członkowie (/manage/members)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Dodatkowy członek testowy (np. po akceptacji zaproszenia).

## Steps

1. Wybierz akcję usuń przy członku, w oknie „Usunąć z organizacji?” potwierdź.
2. Odśwież stronę.
3. Zaloguj się jako usunięty użytkownik.

## Expected result

- Toast „Członek usunięty z organizacji”.
- Po odświeżeniu członek znika z listy (UWAGA: bezpośrednio po akcji interfejs może pozostawić go na liście z rolą „member” – zanotuj).
- Usunięty użytkownik traci dostęp do danych organizacji.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`manager@dev.local`, `pass`). Przypadek
wymaga organizacji z dodatkowym członkiem testowym — czyli profilu `content`: manager
(`admin`), nauczyciel i student, wszyscy w grupie domyślnej `G1`.

```bash
bun scripts/qa-tenant.ts MGR-MEM-04 --fresh
```

- Klucz tenanta: `MGR-MEM-04.md::MGR-MEM-04#<run>::qa-shared` —
  `tenantKey('qa/cases/MGR-MEM-04.md', 'MGR-MEM-04#<run>', 'qa-shared')` + `tenantId`, ten
  sam schemat co fixture'y e2e. Usunięcie członka jest **destrukcyjne**, więc każdy
  niezależny przebieg musi najpierw zaseedować świeży tenant: `--fresh` nadaje nowy
  sufiks przebiegu i nadpisuje `qa/.tenants/MGR-MEM-04.json`.
- Organizacja `qa-mgr-mem-04-<run>` z rolami systemowymi `admin` / `teacher` / `member`
  (w interfejsie: Admin / Teacher / Student) oraz grupą `G1`.
- Konta (`Seed4Test!`): `seed-manager-<hash>@dev.local` (rola org `admin`),
  `seed-educator-<hash>@dev.local` i `seed-student-<hash>@dev.local` (rola org `member`).
  Dodatkowym członkiem testowym jest `student`; `teacher` służy ścieżce „Anuluj”, a wiersz
  managera — kontroli zakazu usunięcia samego siebie.
- Worker QA-suite seeduje **wspólną** bazę (`http://localhost:54421`);
  `scripts/qa-tenant.ts` bierze URL z `qa/env.json`, a klucz service role z
  `apps/web/.env`.
- Spec: `qa/tests/MGR/MGR-MEM-04.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl` (kopie interfejsu w przypadku są polskie).
- Izolacja: test czyta i usuwa wyłącznie wiersze `org_members` swojej organizacji. Nie
  dotyka innego tenanta, flag funkcji, planów ani wierszy singletonowych.

## Observed during the suite walk (qa-env-4, shared app :3010 / DB :54421)

- Wejście: manager → `/manage/members`. Nagłówek „Członkowie” z licznikiem „3 łącznie”;
  tabela ma kolumny Członek / Rola / Grupy / Dołączył / Akcje. Rola `member` jest w UI
  wyświetlana jako **„Student”** (`GET /api/v1/organization/roles` → `name: "member"`,
  `displayName: "Student"`), a grupa jako badge `G1`. Wiersz managera pokazuje „(ty)” i
  nie ma żadnych akcji (brak „Zarządzaj grupami”, przełącznika roli i kosza).
- Akcja „usuń” to ikona kosza z tekstem tylko dla czytników ekranu
  „Usuń członka {imię lub e-mail}”; otwiera okno `alertdialog` o tytule
  „Usunąć z organizacji?”, opisie „Ten członek straci dostęp do zasobów organizacji.” i
  przyciskach „Anuluj” / „Usuń”.
- Potwierdzenie: `DELETE /api/v1/organization/members?userId=<id>` → **200**, toast
  „Członek usunięty z organizacji”. Zgodnie z UWAGĄ przypadku wiersz **pozostaje na
  ekranie** (lista jest łatana lokalnie, bez ponownego pobrania), a licznik nadal pokazuje
  „3 łącznie” — dopiero odświeżenie strony pokazuje „2 łącznie” i brak usuniętego członka.
  To zachowanie jest w przypadku oznaczone jako „zanotuj”, więc specyfikacja asertuje stan
  docelowy (toast + brak wiersza po odświeżeniu), nie nieaktualny wiersz.
- Anulowanie okna nie wysyła żadnego `DELETE` i nie zmienia listy.
- Wymuszone `DELETE` na własne konto managera (`userId` = manager) → **403**
  (`FORBIDDEN`); członkostwo managera zostaje.
- Po usunięciu, jako usunięty student: `GET /api/v1/me/orgs` → `[]`,
  `GET /api/v1/me/groups` → `[]` (trigger `cleanup_group_members_on_org_member_delete`
  czyści `group_members`), `GET /api/v1/organization/members` i
  `GET /api/v1/organization/groups` → **403**. Powłoka `/app` pokazuje „StudiQ /
  Student” zamiast nazwy organizacji — organizacja znika z nawigacji.
