# LIM-04 — Limit grup i członków organizacji (Launch)

- id: LIM-04
- priority: P2 ważny
- module: LIM – Funkcje (feature flags) i limity planów
- section: Egzekwowanie limitów
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

WSB Merito (Launch).

## Steps

1. Wykonaj EDU-GRP-04 oraz ONB-10.

## Expected result

- Granice: 3 grupy, 5 członków (wszystkich ról łącznie).

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`manager@dev.local`, `teacher1@dev.local`,
`pass`). Przypadek jest wspólnym przebiegiem EDU-GRP-04 (limit grup) i ONB-10 (limit
członków), więc tenant musi być organizacją na planie **Launch** z zapasem w obu
licznikach: 1 z 3 grup i 4 z 5 miejsc.

Profil `org-limit` + plan `launch` seeduje dokładnie ten stan:

```bash
bun scripts/qa-tenant.ts LIM-04 --fresh
```

- Plik profilu: `__tests__/qa/profiles/LIM-04.json` →
  `{ "profile": "org-limit", "plan": "launch" }`.
- Klucz tenanta: `LIM-04.md::LIM-04#<run>::qa-shared` —
  `tenantKey('qa/cases/LIM-04.md', 'LIM-04#<run>', 'qa-shared')` + `tenantId`, ten sam
  schemat co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, więc każdy niezależny
  przebieg dostaje świeżą organizację; identyfikatory są deterministyczne w obrębie
  przebiegu (bez losowych UUID).
- Organizacja: plan `launch` (`max_groups = 3`, `max_students = 5`), grupa domyślna `G1`.
- Członkowie (4): `manager` (`admin`, odpowiednik M1), `teacher` i `teacher2`
  (`teacher`, T1/T2), `student` (`member`, S1) — licznik miejsc obejmuje wszystkie role.
- Zaproszeni (poza org): `invitee1`, `invitee2` — konta `student` bez wiersza
  `org_members`, `Seed4Test!`; służą do sprawdzenia granicy 5/5 przez `/app/join`.
- Worker QA-suite seeduje **wspólną** bazę (`http://localhost:54421`); `scripts/qa-tenant.ts`
  bierze URL z `qa/env.json`, a klucz service role z `apps/web/.env`.
- Spec: `__tests__/qa/LIM/LIM-04.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl` (kopie interfejsu są polskie, jak w dokumencie).
- Izolacja: test czyta i zapisuje wyłącznie wiersze swojego tenanta (org, jego grupy,
  członkowie, zaproszenia); nie dotyka flag funkcji, katalogu planów ani wierszy
  singletonowych. Na starcie każdego przebiegu sprząta tylko własne artefakty (grupy
  `LIM-04 Grupa 2/3` i ewentualne członkostwo zaproszonych), więc powtórzenie na tym
  samym tenancie wraca do stanu 1 grupa / 4 członków.

## Observed during the suite walk (qa-env-1, shared app 3010 / DB 54421)

- Część EDU-GRP-04 — nauczyciel (`/edu/groups`): utworzenie 2. i 3. grupy kończy się
  `POST /api/v1/organization/groups` → **201**, toast „Grupa utworzona”, a wiersz pojawia
  się z licznikami 0/0. Czwarta próba → **429**
  `{"success":false,"error":"USAGE_LIMIT_EXCEEDED"}`, toast „Nie udało się utworzyć
  grupy”, okno „Utwórz grupę” zostaje otwarte z wpisaną nazwą, a lista nadal ma 3 grupy.
  Licznik obejmuje grupę domyślną `G1` (1 + 2 utworzone = 3).
- Część ONB-10 — manager (`/manage/invites`): formularz ma wiersze „e-mail + rola”; rola
  `member` jest w UI wyświetlana jako **„Student”**. `POST
/api/v1/organization/invites/bulk` zwraca 2 wyniki, a karta wyników pokazuje dla każdego
  adresu **„Kod zaproszenia: <32 hex>”** (sam token, bez linku).
- Pierwszy zaproszony loguje się i otwiera `/app/join` („Dołącz do klasy”, pole „Kod
  zaproszenia”, przycisk „Dołącz”): `POST /api/v1/organization/invites/accept` → **200**,
  pole kodu się czyści, a `GET /api/v1/me/orgs` pokazuje organizację z
  `orgRoleName: "member"`. Organizacja ma wtedy **5/5** członków (admin + 2 nauczycieli +
  2 uczniów).
- Drugi zaproszony na `/app/join` z własnym kodem: `POST
/api/v1/organization/invites/accept` → **429**, body
  `{"success":false,"error":"USAGE_LIMIT_EXCEEDED"}`; przy polu pojawia się trwały
  komunikat „Ta organizacja osiągnęła limit członków. Kod zaproszenia jest prawidłowy —
  poproś administratora o zwiększenie limitu lub zwolnienie miejsca.”, `#token` pozostaje
  wypełniony (`aria-invalid="true"`), a `GET /api/v1/me/orgs` zwraca `[]`.
- Uwaga warsztatowa: samo wejście na `/edu/groups` zaraz po zalogowaniu przez API (bez
  ustawionego cookie aktywnej organizacji) potrafi wyścignąć przełączenie org i pokazać
  „Nie udało się wczytać listy” (403). Spec wchodzi przez pulpit nauczyciela i pozycję
  „Grupy” w menu, tak jak użytkownik; fixture ustawia `active_org_id` przy logowaniu.
