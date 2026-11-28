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
so this case drives the assignment through them.

## Amendment (2026-11-28, #1511)

A seat pool is a licence: `ai_lite` / `ai_pro` / `ai_max`, each carrying `ai.chat` only and one
daily AI quota row (100 000 / 300 000 / 1 000 000), sold on the `seat_pool` channel. A licence seat
grants its own keys, and the organization ceiling no longer intersects it (**D38**): a seat adds AI
and its tier quota, and **no** content limit and **no** non-AI feature. The member's quota is
`max(org, seat, personal)`, so a Plus member on an `ai_pro` seat resolves 300 000/day while
`max_flashcards` stays the Hub floor (5 000). The portable `ai.chat` still comes from the member's
personal Plus plan (`personalPlan: "plus"`); a manager holds no personal plan (ADR-0007), so the
seeder applies Plus to every non-manager member only.

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
  product's API (`POST /api/v1/organization/seats/pools`), one per licence tier:
  **Lite ×1, Pro ×3, Max ×2**. The seat rows of **this tenant only** are
  cleared in the fixture, so a re-run of a pinned `QA_RUN_SUFFIX` starts again from
  „pools nobody holds”.
- The spec seeds the graph at run time with the shared helpers
  (`__tests__/helpers/tenant-seed.ts`) because every independent run needs its own
  organization, users and pools.

## Steps

1. Wywołaj `POST /api/v1/organization/seats/assignments` z `userId` studenta i `poolId`
   puli `ai_pro` (licencja AI; plan osobisty bez `audience`).
2. Sprawdź funkcje/limity członka po zalogowaniu.

## Expected result

- W „Przydziałach” nowy wpis; w puli przydzielone +1, dostępne −1; inne pule bez zmian.
- **The seat on the hub org.** A licence seat grants `ai.chat` and its tier quota; the
  organization ceiling does not intersect it (D38, #1511). The learner profile grants
  `flashcards`/`quiz` from the Hub ceiling, the personal Plus plan adds its portable
  `ai.chat`/`quiz.templates`, and the `ai_pro` seat adds `ai.chat` — which Plus already
  carries — so `/api/v1/me/entitlements` holds the same four keys with and without the seat:
  `ai.chat, flashcards, quiz, quiz.templates`. **No `stats.insights`**: a licence carries no
  insight and no content key, and a seat no longer inherits the ceiling's.
  `/api/v1/me/plan` → `key: 'ai_pro'`, `limits.max_ai_tokens_per_day === 300000` (the tier
  quota over Plus 100 000 and Hub's absent AI row, D28/D30) and
  `limits.max_flashcards === 5000` (Hub; the licence has no content limit).
  `/api/v1/ai/usage` → `limit: 300000`, `plan: 'hub'` (the effective primary stays the org
  plan, D30). The seat's observable effect is the quota: 300 000/day against the member's
  100 000. `student2` (no seat) stays on Plus: `max_ai_tokens_per_day === 100000`,
  `max_flashcards === 5000` — the seat is per-member, not org-wide.
- Po wyborze członka dostępne są **wszystkie** pule organizacji: plan osobisty nie ma
  `audience` od #1193, więc persona nie filtruje już wyboru puli. Od #1493 wyboru nie ma
  w UI — pule i przydziały są tylko do odczytu, a zapis idzie przez API.

> 2026-11-22 (phase 4b; limits updated by #1193, story updated by #1493) — the seat ∩
> ceiling rule did not move with the story then: it was pinned by
> `__tests__/unit/services/entitlement.resolver.test.ts` („intersects the seat plan
> with the org ceiling”) and by the `manager-plan-model` / `limits-resolution`
> integration cases. **2026-11-28 (#1511, D38) retires that rule**: a seat licence grants
> its own keys and the ceiling no longer filters them, so a Max seat no longer adds
> `stats.insights`; the user-scope limits still come from `max(org, seat, personal)`.

## Walk observations (qa-env-6, shared app 3010 / DB 54421, pl, run `rmvsmdfmd1c4f` — pre-4b walk; the picker copy below is superseded by the 4b rewrite, the dialog by the #1493 seat freeze, and the seat ∩ ceiling rows by #1511/D38)

- `/manage/seats` („Licencje miejsc”) lists the purchased pools with the columns
  „Wykupione / Przydzielone / Dostępne” and the „Przydziały” table. The MGR-SEAT-01
  purchase dialog shows „Miejsca dodane do puli” — the prerequisite state.
- „Przydziel miejsce” opens a dialog with „Członek” and „Plan miejsca”. The member picker
  lists every member with the org role (`(admin)`, `(teacher)`, `(member)`); the plan
  picker is **disabled** and shows „Najpierw wybierz członka” until a member is chosen.
- Since #1193 the plan picker offers **every** pool of the org to any picked member: the
  four individual pools that walk held („StudiQ Free (0/1)”, „StudiQ Plus (0/3)”, „StudiQ
  Pro (0/3)”, „StudiQ Max (0/2)” — a licence pool replaced them in #1511). A
  personal plan carries no `audience`, so persona no longer filters the list.
  „Przydziel” stays disabled until a plan is chosen too.
- „Przydziel” → toast **„Miejsce przydzielone pomyślnie”**, the dialog closes, a new row
  appears in „Przydziały” (member name, seat plan, date), and the pool row moves from
  2 / 0 / 2 to **2 / 1 / 1** (assigned +1, available −1). The other pools keep their
  counters. The seated member disappears from the member picker.
- On the member's next login under hub: `GET /api/v1/me/plan` returned the seat plan with
  its quota and `GET /api/v1/ai/usage` reported `limit: 500000, plan: 'hub'`. The walk saw
  `stats.insights` appear and the Max seat's 500 000 — both superseded by #1511/D38: a
  licence seat carries `ai.chat` and the tier quota only. The unseated `student2` keeps
  `limit: 100000` and no `stats.insights`. Org-scoped entitlements are never _added_
  through a seat: since #1511 that is structural, because every seat key is
  `scope: 'personal'` and `branding` (Campus) is never `seatEligible`.
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
