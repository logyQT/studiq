# MGR-SEAT-02 — Przydzielenie miejsca członkowi

- id: MGR-SEAT-02
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Licencje / miejsca (/manage/seats)
- prereqs: MGR-SEAT-01
- source: StudiQ Dokument Testera v1.3

## Amendment (2026-11-26, B2 #1493)

Seats are frozen at the UI: `/manage/seats` keeps the pools/assignments tables and every `GET`, but
hides the purchase, assign and release controls. The API routes stay as the data path for #1511,
so this case drives the assignment through them. The organization ladder is cumulative: the Hub
ceiling carries `quiz.templates` and `stats.insights`, while a `member` role resolves only the
learner profile (`flashcards`, `quiz`), and a seat intersects that ceiling. A Max seat therefore
adds `stats.insights` and raises the user-scope **limits**; the portable `ai.chat` comes from the
member's personal Plus plan (`personalPlan: "plus"`). A manager holds no personal plan (ADR-0007),
so the seeder applies Plus to every non-manager member only.

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
- **Profile**: `__tests__/qa/profiles/MGR-SEAT-02.json` declares
  `{"profile": "content", "plan": "hub", "personalPlan": "plus"}` — the tenant's
  organization sits on the cumulative **hub** plan and every non-manager
  member's personal **Plus** plan carries the portable keys (`ai.chat`, `quiz.templates`)
  into the org — plus an explicit `members` roster:
  - `manager` — manager account, `admin` org role;
  - `teacher` — educator account, `teacher` org role;
  - `student` — student account, `member` org role — the member the seat is assigned to;
  - `student2` — student account, `member` org role — the unseated control.
- **Seat pools** (the „pula z MGR-SEAT-01”): provisioned at run time through the
  product's API (`POST /api/v1/organization/seats/pools`), one per individual plan:
  **Free ×1, Plus ×3, Pro ×3, Max ×2**. The seat rows of **this tenant only** are
  cleared in the fixture, so a re-run of a pinned `QA_RUN_SUFFIX` starts again from
  „pools nobody holds”.
- The spec seeds the graph at run time with the shared helpers
  (`__tests__/helpers/tenant-seed.ts`) because every independent run needs its own
  organization, users and pools.

## Steps

1. Wywołaj `POST /api/v1/organization/seats/assignments` z `userId` studenta i `poolId`
   puli `max` (plan osobisty bez `audience`).
2. Sprawdź funkcje/limity członka po zalogowaniu.

## Expected result

- W „Przydziałach” nowy wpis; w puli przydzielone +1, dostępne −1; inne pule bez zmian.
- **The seat-upgrade story on the cumulative hub org.** The Hub ceiling carries
  `quiz.templates` and `stats.insights`; a `member` role resolves the learner profile
  (`flashcards`, `quiz`) ∩ ceiling, so before the seat the member's
  `/api/v1/me/entitlements` is the personal Plus plan's portable keys plus the two
  baseline keys (`ai.chat, flashcards, quiz, quiz.templates`). The Max seat intersects the
  ceiling and adds the one key the profile lacks, `stats.insights`.
  `/api/v1/me/plan` → `key: 'max'` with `limits.max_flashcards === 25000` and
  `limits.max_ai_tokens_per_day === 500000` (the user-scope limit is
  `max(org, seat, personal)`, D28/D30). `/api/v1/ai/usage` → `limit: 500000`,
  `plan: 'hub'` (the effective primary stays the org plan, D30).
  `student2` (no seat) keeps `max_flashcards === 5000` (the hub floor) and
  `max_ai_tokens_per_day === 100000` (the Plus budget): the seat is per-member, not
  org-wide.
- Po wyborze członka dostępne są **wszystkie** pule organizacji: plan osobisty nie ma
  `audience` od #1193, więc persona nie filtruje już wyboru puli. Od #1493 wyboru nie ma
  w UI — pule i przydziały są tylko do odczytu, a zapis idzie przez API.

> 2026-11-22 (phase 4b; limits updated by #1193, story updated by #1493) — the seat ∩
> ceiling rule did not move with the story: it is pinned by
> `__tests__/unit/services/entitlement.resolver.test.ts` („intersects the seat plan
> with the org ceiling”) and by the `manager-plan-model` / `limits-resolution`
> integration cases. The intersection is what lets the Max seat add `stats.insights` from
> the Hub ceiling while the user-scope limits still come from `max(org, seat, personal)`.

## Walk observations (qa-env-6, shared app 3010 / DB 54421, pl, run `rmvsmdfmd1c4f` — pre-4b walk; the picker copy below is superseded by the 4b rewrite, and the dialog by the #1493 seat freeze)

- `/manage/seats` („Licencje miejsc”) lists the purchased pools with the columns
  „Wykupione / Przydzielone / Dostępne” and the „Przydziały” table. The MGR-SEAT-01
  purchase dialog shows „Miejsca dodane do puli” — the prerequisite state.
- „Przydziel miejsce” opens a dialog with „Członek” and „Plan miejsca”. The member picker
  lists every member with the org role (`(admin)`, `(teacher)`, `(member)`); the plan
  picker is **disabled** and shows „Najpierw wybierz członka” until a member is chosen.
- Since #1193 the plan picker offers **every** pool of the org to any picked member:
  „StudiQ Free (0/1)”, „StudiQ Plus (0/3)”, „StudiQ Pro (0/3)”, „StudiQ Max (0/2)”. A
  personal plan carries no `audience`, so persona no longer filters the list.
  „Przydziel” stays disabled until a plan is chosen too.
- „Przydziel” → toast **„Miejsce przydzielone pomyślnie”**, the dialog closes, a new row
  appears in „Przydziały” (member name, seat plan, date), and the pool row moves from
  2 / 0 / 2 to **2 / 1 / 1** (assigned +1, available −1). The other pools keep their
  counters. The seated member disappears from the member picker.
- On the member's next login under hub: `GET /api/v1/me/entitlements` grows by exactly
  `stats.insights` (seat ∩ hub ceiling; the pre-4b launch-org walk observed no growth —
  superseded), `GET /api/v1/me/plan` returns `max` with
  `max_ai_tokens_per_day = 500000`, and `GET /api/v1/ai/usage` reports
  `limit: 500000, plan: 'hub'`. The unseated `student2` keeps
  `limit: 100000` and no `stats.insights`. Org-scoped entitlements are never _added_
  through a seat beyond what the learner profile already grants from the ceiling
  (`branding` is in both).
- The guards behind the pickers hold server-side too: a second seat for the
  already-seated member → **429** `USAGE_LIMIT_EXCEEDED`; a different member accepts
  any pool, including one whose plan used to name another persona → **201**.
- Not asserted (out of scope, settled in 2b-7): a **teacher** seated on „StudiQ Pro”
  receives no management key. The legacy management markers (`org.manage`,
  `member.manage`, `role.builder`, `group.manage`) left the entitlement catalog in
  2b-7 — they are permissions now — so a seat plan, which must be all-`seatEligible`,
  can no longer carry them and no admin-only strip is needed. The case's step 1
  assigns a seat to a member, so the spec asserts the member path and pins that no
  org-scoped entitlement arrives through the seat beyond the ceiling.
