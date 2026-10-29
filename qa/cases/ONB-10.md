# ONB-10 — Limit członków organizacji przy akceptacji zaproszeń

- id: ONB-10
- priority: P1 krytyczny
- module: ONB – Onboarding, organizacje i zaproszenia
- section: Zaproszenie przez link (/join?token=…)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

WSB Merito ma 4 członków (M1, T1, T2, S1); plan Launch ma limit 5. Przygotuj 2 nowe zaproszenia.

## Steps

1. Jako manager@dev.local (WSB Merito) wyślij zaproszenia na dwa nowe adresy (rola „member”).
2. Zaakceptuj pierwsze zaproszenie (rejestracja / dołączenie).
3. Zaakceptuj drugie zaproszenie.

## Expected result

- Pierwsze dołączenie się udaje (5 z 5 członków).
- Drugie jest odrzucone błędem limitu (kod USAGE_LIMIT_EXCEEDED / HTTP 429, komunikat o przekroczeniu limitu) – licznik obejmuje WSZYSTKICH członków organizacji (także nauczycieli i admina).
- Użytkownik drugiego zaproszenia nie jest dodany do org_members.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`manager@dev.local`, `pass`). Przypadek
wymaga organizacji **jeden etat poniżej limitu planu**: 4 członków w org z limitem 5.
Tenant `org-limit` seeduje dokładnie ten stan:

```bash
bun scripts/qa-tenant.ts ONB-10 --profile org-limit --fresh
```

- Klucz tenanta: `ONB-10.md::ONB-10#<run>::qa-shared` —
  `tenantKey('qa/cases/ONB-10.md', 'ONB-10#<run>', 'qa-shared')` + `tenantId`, ten sam
  schemat co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, więc każdy niezależny
  przebieg dostaje świeżą organizację; identyfikatory są deterministyczne w obrębie
  przebiegu (bez losowych UUID).
- Organizacja: plan `launch` (`max_students = 5`), grupa domyślna `G1`.
- Członkowie (4): manager (`admin`), `teacher` i `teacher2` (`teacher`), `student`
  (`member`) — licznik limitu obejmuje wszystkie role, nie tylko uczniów.
- Zaproszeni (poza org): `invitee1`, `invitee2` — konta `student` bez wiersza
  `org_members`, `Seed4Test!`.
- Worker QA-suite seeduje **wspólną** bazę (`http://localhost:54421`); `scripts/qa-tenant.ts`
  bierze URL z `qa/env.json`, a klucz service role z `apps/web/.env`.
- Spec: `__tests__/qa/ONB/ONB-10.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=en`.
- Izolacja: test czyta i zapisuje wyłącznie wiersze swojego tenanta (org, jego członkowie,
  jego zaproszenia); nie dotyka flag funkcji, katalogu planów ani wierszy singletonowych.

## Observed during the suite walk (qa-env-8, shared app 3010 / DB 54421)

- Krok 1 — `/manage/invites`: dwie pary „e-mail + rola”. Rola `member` jest w UI
  wyświetlana jako **„Student”** (`GET /api/v1/organization/roles` → `name: "member"`,
  `displayName: "Student"`). Po wysłaniu `POST /api/v1/organization/invites/bulk` zwraca
  2 wyniki, a karta wyników pokazuje dla każdego adresu **„Invite code: <32 hex>”**
  (sam token, bez linku) — to ten kod wkleja zaproszony.
- Krok 2 — zaproszony loguje się i otwiera `/app/join` (ekran „Join a Classroom”, pole
  „Invite code”, przycisk „Join”), wkleja kod i dołącza: `POST
/api/v1/organization/invites/accept` → **200**, toast „You've joined the classroom!”,
  pole kodu się czyści, a `GET /api/v1/me/orgs` pokazuje organizację z
  `orgRoleName: "member"` i `isActive: true`. Organizacja ma wtedy **5/5** członków
  (admin + 2 nauczycieli + 2 uczniów).
- Krok 3 — drugi zaproszony na `/app/join` z własnym kodem: `POST
/api/v1/organization/invites/accept` → **429**, body
  `{"success":false,"error":"USAGE_LIMIT_EXCEEDED"}`; przy polu pojawia się trwały
  komunikat „This organization has reached its member limit…”, `#token` pozostaje
  wypełniony (`aria-invalid="true"`). `GET /api/v1/me/orgs` zwraca `[]`, a podgląd
  `GET /api/v1/organization/invites?token=…` nadal działa — zaproszenie nie zostało
  spalone, odrzucił je tylko limit miejsc.
- Ścieżka rejestracji przez `/join?token=…` (rejestracja + aktywacja e-mailem) używa tej
  samej funkcji akceptacji, ale akceptacja przy aktywacji jest best-effort: przy pełnej
  organizacji konto powstaje bez członkostwa, a komunikat o limicie pojawia się dopiero
  na `/app/join`. Dlatego automatyczny krok „dołączenie” idzie przez `/app/join`
  zalogowanego zaproszonego (bez zależności od skrzynki Inbucket).
