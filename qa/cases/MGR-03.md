# MGR-03 — Dane różnią się między organizacjami

- id: MGR-03
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Pulpit managera
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

M1 ma dwie organizacje.

## Seed (tenant model)

Automatyzacja nie używa kont z ręcznego seeda (`manager@dev.local`, `pass`, WSB Merito /
UE Wrocław). Przypadek dostaje własny tenant z managerem, który jest adminem **dwóch**
organizacji, i osobnym zestawem danych w każdej z nich:

```bash
bunx playwright test -c qa/playwright.qa.config.ts \
  __tests__/qa/MGR/MGR-03.spec.ts --workers=1
```

Spec seeduje wszystko sam przez `seedTenantGraph()` (`__tests__/helpers/tenant-seed.ts`),
więc nie wymaga wcześniejszego uruchomienia `scripts/qa-tenant.ts`.

- Klucz tenanta: `MGR-03.md::MGR-03 organization data isolation::qa-shared::<run>` —
  `tenantKey('qa/cases/MGR-03.md', <tytuł>, 'qa-shared')` + `tenantId`, ten sam schemat co
  fixture'y e2e, z sufiksem `::org-a` / `::org-b` na organizację (wspólny `org_members.id`
  by się inaczej nadpisał). Domyślnie każdy przebieg dostaje świeży sufiks, więc ma własną
  parę organizacji; `QA_RUN_SUFFIX` utrwala przebieg.
- Manager `seed-manager-<hash>@dev.local` / `Seed4Test!` — jedno konto, dwa członkostwa:
  rola `admin` w obu organizacjach.
- Organizacja A `QA MGR-03 A <run>`: student S1 `seed-student-<hash>@dev.local`, nauczyciel
  T1 `seed-educator-<hash>@dev.local` (rola organizacyjna `teacher`), grupy `O1G1-<run>`
  (domyślna, S1 i T1 w środku) i `O1G2-<run>`, jedno oczekujące zaproszenie
  `mgr03-invite-a-<run>@test.local`. Liczniki pulpitu: 3 członków / 1 wykładowca /
  1 student.
- Organizacja B `QA MGR-03 B <run>`: student S2 `seed-student-<hash>@dev.local`, grupy
  `O2G1-<run>` i `O2G2-<run>`, jedno oczekujące zaproszenie
  `mgr03-invite-b-<run>@test.local`. Liczniki pulpitu: 2 członków / 0 wykładowców /
  1 student — celowo inne niż w A, żeby licznik przeciekający z drugiej organizacji nie
  mógł przypadkiem zgodzić się z oczekiwanym.
- Druga grupa w każdej organizacji ma managera jako nauczyciela. Lista grup
  (`/api/v1/organization/groups`) pokazuje grupę tylko wtedy, gdy ma członka z rolą
  `teacher`.
- Spec: `__tests__/qa/MGR/MGR-03.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl` (kopie interfejsu w przypadku są polskie).
- Izolacja: test przełącza wyłącznie organizacje własnego tenanta i czyta listy własnych
  organizacji. Nie dotyka innego tenanta, ustawień admina, flag funkcji, planów,
  statystyk platformy ani wierszy singletonowych.

## Steps

1. Przełącz aktywną organizację z WSB Merito na UE Wrocław (przełącznik u góry paska).
2. Porównaj członków, grupy, zaproszenia.

## Expected result

- Po przełączeniu następuje powrót na /manage; dane (członkowie: S1 vs S2, grupy O1G* vs O2G*) odpowiadają aktywnej organizacji.
- Brak mieszania danych między organizacjami.

## Observations (walk 2026-10-28, shared app :3010, worker qa-env-2)

- Przełącznik organizacji to przycisk na górze sidebara (nazwa organizacji + rola pod
  nią). Menu ma nagłówek „Organizacje”, listę organizacji z rolą i znacznikiem ✓ przy
  aktywnej; wybór organizacji od razu przełącza dane.
- Przełączenie z `/manage` nie zmienia trasy (zostaje `/manage`), a karty pulpitu i
  „Ostatni członkowie” od razu pokazują drugą organizację: „Łączna liczba członków” =
  3 / „Wykładowcy” = 1 / „Studenci” = 1 dla organizacji A oraz 2 / 0 / 1 dla organizacji
  B, a na liście tylko student tej organizacji (S1 albo S2).
- Przełączenie z podstrony (np. `/manage/invites`) przenosi na `/manage` — zgodnie z
  oczekiwanym rezultatem.
- `/manage/members` w aktywnej organizacji: „3 łącznie” (A) lub „2 łącznie” (B),
  manager (Admin, obie grupy tej organizacji), student tej organizacji z badge swojej
  grupy domyślnej, a w A dodatkowo nauczyciel T1 z rolą „Teacher” (nazwy ról
  systemowych pochodzą z `org_roles.display_name` i są angielskie); e-mail i nazwa
  studenta drugiej organizacji nie występują.
- `/manage/groups`: dokładnie dwie grupy aktywnej organizacji (`O1G1`/`O1G2` albo
  `O2G1`/`O2G2`), z licznikiem członków i nauczycieli; grup drugiej organizacji nie ma.
- `/manage/invites` → „Wysłane zaproszenia”: tylko oczekujące zaproszenie aktywnej
  organizacji (status „Oczekujące”); zaproszenie drugiej organizacji nie występuje.
- Wybór organizacji jest stanem serwera (`active_org_id` w cookie): odświeżenie
  `/manage/members` pokazuje nadal tę samą organizację, a powrót przełącznikiem przywraca
  dane pierwszej organizacji w obu kierunkach.
