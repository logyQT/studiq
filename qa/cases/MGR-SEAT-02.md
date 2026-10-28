# MGR-SEAT-02 — Przydzielenie miejsca członkowi

- id: MGR-SEAT-02
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Licencje / miejsca (/manage/seats)
- prereqs: MGR-SEAT-01
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Pula z MGR-SEAT-01.

## Prerequisite context

### MGR-SEAT-01 — Zakup miejsc (symulacja)

_Warunek wstępny: M1._

1. Kliknij „Kup miejsca”, wybierz plan i ilość 3, kliknij „Kup”.
2. Spróbuj ilości 0 oraz ujemnej.

Expected:

- Toast „Miejsca dodane do puli”; pula na liście ma 3 wykupione, 0 przydzielonych, 3 dostępne.
- Przycisk „Kup” jest nieaktywny bez planu lub przy ilości < 1.

## Prerequisite context (tenant model)

The automated case never uses the manual seed (`manager@dev.local`, `pass`). It owns a
seeded tenant instead:

- **Tenant key**: `tenantKey('qa/cases/MGR-SEAT-02.md', 'MGR-SEAT-02 assigning a seat to a member', 'qa-shared')`
  plus a per-run suffix (`QA_RUN_SUFFIX`, otherwise fresh). Every org/user/role id is
  `tenantId(key, entity)`; the e-mails are `qa+<shorthash>+<role>@test.local`.
- **Organization**: one org (`qa-mgr-seat02-<run>`) on the default `launch` plan, with the
  system roles `admin` / `teacher` / `member` from the organization trigger.
- **Users** (password `Seed4Test!`):
  - `manager` — manager account, `admin` org role — the „M1” counterpart;
  - `teacher` — educator account, `teacher` org role (educator tier);
  - `student` — student account, `member` org role (student tier) — the member the seat is
    assigned to.
- **Seat pools** (the „pula z MGR-SEAT-01”): bought at run time through the product's own
  API (`POST /api/v1/organization/seats/pools`), one per tier so the role/tier filter is
  observable: Ace ×3 (student), Creator ×3 (educator), Campus ×1 (manager). The seat rows
  of **this tenant only** are cleared in the fixture, so a re-run of a pinned
  `QA_RUN_SUFFIX` starts again from „pools nobody holds”.
- **Profile**: no content (`content` graph minus decks/banks/quizzes); the case only
  touches the seats surface and the seated member's entitlements.
- The spec seeds the graph at run time with the shared helpers
  (`__tests__/helpers/tenant-seed.ts`) because every independent run needs its own
  organization, users and pools.

## Steps

1. Kliknij „Przydziel miejsce”, wybierz członka i plan miejsca, kliknij „Przydziel”.
2. Sprawdź jego funkcje/limity po zalogowaniu.

## Expected result

- Toast „Miejsce przydzielone pomyślnie”; w „Przydziałach” nowy wpis; w puli przydzielone +1, dostępne −1.
- Członek otrzymuje funkcje/limity planu miejsca (np. dostęp do AI dla planu premium) – role administracyjne nie otrzymują funkcji wyłącznie-adminowych.
- Dostępne są tylko pule pasujące do poziomu (tier) członka.

## Walk observations (qa-env-6, shared app 3010 / DB 54421, pl, run `rmvsmdfmd1c4f`)

- `/manage/seats` („Licencje miejsc”) lists the purchased pools with the columns
  „Wykupione / Przydzielone / Dostępne” and an empty „Przydziały” table. The MGR-SEAT-01
  purchase dialog shows „Miejsca dodane do puli” and the pool appears as 3 / 0 / 3 — the
  prerequisite state.
- „Przydziel miejsce” opens a dialog with „Członek” and „Plan miejsca”. The member picker
  lists every member with the org role (`(admin)`, `(teacher)`, `(member)`); the plan
  picker is **disabled** and shows „Najpierw wybierz członka” until a member is chosen.
- After a member is picked, the plan picker offers **only the pools of that member's
  tier**: `member` → „StudiQ Ace (0/3)”, `teacher` → „StudiQ Creator (0/3)”,
  `admin` → „StudiQ Campus (0/1)”. Pools of the other tiers are not listed (step 3 of the
  expected result). „Przydziel” stays disabled until a plan is chosen too.
- „Przydziel” → toast **„Miejsce przydzielone pomyślnie”**, the dialog closes, a new row
  appears in „Przydziały” (member name, plan „StudiQ Ace”, date), and the pool row moves
  from 3 / 0 / 3 to **3 / 1 / 2** (assigned +1, available −1). The Creator and Campus pools
  keep their counters. The seated member disappears from the member picker.
- The member's next login shows the seat plan: the sidebar gains the „Asystent Q” entry
  (`ai.chat`) and `/app/ai` renders the composer instead of the plan gate „Asystent Q nie
  jest dostępny w Twoim planie”. `GET /api/v1/features/me` grows from
  `flashcards, quiz, documents` to `ai.chat, flashcards, quiz, documents, advanced.stats`
  (the Ace additions), with no `org.manage` / `member.manage` / `role.builder`;
  `GET /api/v1/me/plan` returns `ace`, and `GET /api/v1/ai/usage` moves from limit `0` to
  Ace's `max_ai_tokens_per_day` (200000 at seed time).
- The guards behind the pickers hold server-side too: a second seat for the already-seated
  member → **429** `USAGE_LIMIT_EXCEEDED`; a Creator (educator) pool for the student
  `member` → **400** `BAD_REQUEST`; no assignment is created and the counters do not move.
- Not asserted (out of scope, ambiguity to triage): a **teacher** seated on „StudiQ
  Creator” receives `member.manage`. `teacher` roles of a `launch` org already carry
  `org.manage` (the org trigger gives teachers everything except `member.manage` and
  `role.builder`), and `FeatureResolver` treats „has `org.manage`” as „admin”, so the
  admin-only strip does not run. The case's step 1 assigns a seat to a member, so the spec
  asserts the member path; the teacher/educator-seat path is a separate decision (feature
  exposure only — the API permission scopes for `teacher` still deny member management).
