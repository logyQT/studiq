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
- Seat entitlements are intersected with the org ceiling (ADR-0015 §5.4): a seat cannot grant an entitlement the org did not buy. The org here is on `launch` (only `flashcards`, `quiz`), so after the Ace seat the member's `/api/v1/features/me` is **unchanged** — no `ai.chat`, no org-scoped key such as `branding`; the sidebar keeps no „Asystent Q” entry and `/app/ai` keeps the plan gate. The seat is still the member's effective plan (`/api/v1/me/plan` → `ace`) and, in phase 3a, the user-scope AI-token limit is the seat plan's own (`ace.limits.max_ai_tokens_per_day`) even though `ai.chat` is not entitled.
- Dostępne są tylko pule pasujące do poziomu (tier) członka.

> 2026-11-21 (phase 3a) — ADR §5.4: a seat cannot grant an entitlement the org did not buy; a launch-org seat therefore grants no feature. The positive seat-upgrade demonstration moves to phase 4, which owns audience validation, `seat ∩ ceiling` and `max(org, seat, personal)` (candidate: a non-learner key such as `advanced.stats` on an org plan that carries it; the plan data currently has no lower-tier org plan with `ai.chat`, so an "AI limit rises" story needs a phase-4 plan-data decision).

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
- The member's next login under phase 3a shows the ceiling rule, not the seat plan: the sidebar keeps no „Asystent Q” entry (`ai.chat`) and `/app/ai` keeps the plan gate „Asystent Q nie jest dostępny w Twoim planie”, because `GET /api/v1/features/me` stays at `flashcards, quiz` — the seat's entitlements are intersected with the org ceiling and the launch org did not buy `ai.chat` (superseded: the pre-3a walk below observed the additive behaviour, `ai.chat, flashcards, quiz, advanced.stats` growing from `flashcards, quiz`; `documents` is absent until its surface ships — open catalog, ADR §5.1), with no org-scoped key such as `branding` — a seat is a personal plan and never grants one (the legacy management markers left the catalog in 2b-7);
  `GET /api/v1/me/plan` returns `ace`, and `GET /api/v1/ai/usage` reports Ace's `max_ai_tokens_per_day` (200000 at seed time) because the phase-3a limit composition is seat-exclusive.
- The guards behind the pickers hold server-side too: a second seat for the already-seated
  member → **429** `USAGE_LIMIT_EXCEEDED`; a Creator (educator) pool for the student
  `member` → **400** `BAD_REQUEST`; no assignment is created and the counters do not move.
- Not asserted (out of scope, settled in 2b-7): a **teacher** seated on „StudiQ Creator”
  receives no management key. The legacy management markers (`org.manage`,
  `member.manage`, `role.builder`, `group.manage`) left the entitlement catalog in
  2b-7 — they are permissions now — so a seat plan, which must be all-`seatEligible`,
  can no longer carry them and no admin-only strip is needed. The case's step 1
  assigns a seat to a member, so the spec asserts the member path and pins that no
  org-scoped entitlement (`branding`) arrives through the seat.
