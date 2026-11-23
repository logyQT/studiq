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
- **Profile**: `__tests__/qa/profiles/MGR-SEAT-02.json` declares
  `{"profile": "content", "plan": "hub"}` — the tenant's organization sits on the
  **hub** plan, whose ceiling carries the learner keys (`ai.chat`, `branding`,
  `flashcards`, `quiz`) **and** the non-learner `stats.insights` — plus an explicit
  `members` roster:
  - `manager` — manager account, `admin` org role;
  - `teacher` — educator account, `teacher` org role;
  - `student` — student account, `member` org role — the member the seat is assigned to;
  - `student2` — student account, `member` org role — the unseated control.
- **Seat pools** (the „pula z MGR-SEAT-01”): bought at run time through the product's own
  API (`POST /api/v1/organization/seats/pools`), one per plan `audience` so the
  persona filter is observable: **Ace ×3 (student), Pro ×2 (student), Creator ×3
  (educator), Solo ×1 (manager)**. The seat rows of **this tenant only** are cleared in
  the fixture, so a re-run of a pinned `QA_RUN_SUFFIX` starts again from „pools nobody
  holds”.
- **Profile**: `content` graph (decks/banks/quizzes included); the case only touches the
  seats surface and the seated member's entitlements.
- The spec seeds the graph at run time with the shared helpers
  (`__tests__/helpers/tenant-seed.ts`) because every independent run needs its own
  organization, users and pools.

## Steps

1. Kliknij „Przydziel miejsce”, wybierz członka i plan miejsca, kliknij „Przydziel”.
2. Sprawdź jego funkcje/limity po zalogowaniu.

## Expected result

- Toast „Miejsce przydzielone pomyślnie”; w „Przydziałach” nowy wpis; w puli przydzielone +1, dostępne −1.
- **The positive seat-upgrade story (phase 4b, on a hub org).** The case assigns the
  **`pro`** seat to `student` through the UI. Before the seat the member's
  `/api/v1/me/entitlements` is the learner profile ∩ the hub ceiling =
  `ai.chat, branding, flashcards, quiz`. After the seat the **exact diff is
  `stats.insights`** — a non-learner key the hub ceiling carries, so the seat ∩ ceiling
  rule (ADR-0015 §5.4: a seat cannot grant an entitlement the org did not buy) visibly
  grants it — and the seat adds no other key. `/api/v1/me/plan` → `key: 'pro'` with
  `limits.max_ai_tokens_per_day === -1` and `features` including `stats.insights` (the
  seat is the member's effective plan, D28/D30). `/api/v1/ai/usage` → `limit: -1`,
  `plan: 'hub'` (the effective primary stays the org plan, D30) — the seat **raises**
  the AI limit from hub's 200000, which is the visible positive seat story.
  `student2` (no seat) keeps `max_ai_tokens_per_day === 200000` and no `stats.insights`:
  the seat is per-member, not org-wide.
- Dostępne są tylko pule, których plan ma `audience` równy personie (`accountType`)
  wybranego członka — filtr jest po personie, nie po roli org.

> 2026-11-22 (phase 4b) — the seat ∩ ceiling rule did not move with the story: it is
> pinned by `__tests__/unit/services/entitlement.resolver.test.ts` („intersects the
> seat plan with the org ceiling”) and by the `manager-plan-model` /
> `limits-resolution` integration cases. The case moved from a launch-org negative
> (a seat there grants nothing, because launch's ceiling is `flashcards`+`quiz` only)
> to a hub-org positive (the `pro` seat adds exactly `stats.insights` and raises the
> AI-token limit to unlimited) without losing the rule. The earlier 2026-11-21 note
> below is kept as history.
>
> 2026-11-21 (phase 3a) — ADR §5.4: a seat cannot grant an entitlement the org did not
> buy; a launch-org seat therefore grants no feature. The positive seat-upgrade
> demonstration moves to phase 4, which owns audience validation, `seat ∩ ceiling` and
> `max(org, seat, personal)`.

## Walk observations (qa-env-6, shared app 3010 / DB 54421, pl, run `rmvsmdfmd1c4f` — pre-4b walk; the picker copy below is superseded by the 4b rewrite)

- `/manage/seats` („Licencje miejsc”) lists the purchased pools with the columns
  „Wykupione / Przydzielone / Dostępne” and the „Przydziały” table. The MGR-SEAT-01
  purchase dialog shows „Miejsca dodane do puli” — the prerequisite state.
- „Przydziel miejsce” opens a dialog with „Członek” and „Plan miejsca”. The member picker
  lists every member with the org role (`(admin)`, `(teacher)`, `(member)`); the plan
  picker is **disabled** and shows „Najpierw wybierz członka” until a member is chosen.
- Since 4b the plan picker offers, for the picked member, exactly the pools whose plan
  `audience` equals the member's `accountType` (from the roster's new `accountType`
  field): `student` → „StudiQ Ace (0/3)” and „StudiQ Pro (0/2)”, `teacher` →
  „StudiQ Creator (0/3)”, `admin` → „StudiQ Solo (0/1)”. Pools of the other audiences are
  not listed. „Przydziel” stays disabled until a plan is chosen too.
- „Przydziel” → toast **„Miejsce przydzielone pomyślnie”**, the dialog closes, a new row
  appears in „Przydziały” (member name, seat plan, date), and the pool row moves from
  2 / 0 / 2 to **2 / 1 / 1** (assigned +1, available −1). The other pools keep their
  counters. The seated member disappears from the member picker.
- On the member's next login under hub: `GET /api/v1/me/entitlements` grows by exactly
  `stats.insights` (seat ∩ hub ceiling; the pre-4b launch-org walk observed no growth —
  superseded), `GET /api/v1/me/plan` returns `pro` with `max_ai_tokens_per_day = -1`, and
  `GET /api/v1/ai/usage` reports `limit: -1, plan: 'hub'`. The unseated `student2` keeps
  `limit: 200000` and no `stats.insights`. Org-scoped entitlements are never _added_
  through a seat beyond what the learner profile already grants from the ceiling
  (`branding` is in both).
- The guards behind the pickers hold server-side too: a second seat for the
  already-seated member → **429** `USAGE_LIMIT_EXCEEDED`; a manager-audience (`solo`)
  pool for the student → **400** `BAD_REQUEST`; no assignment is created and the
  counters do not move.
- Not asserted (out of scope, settled in 2b-7): a **teacher** seated on „StudiQ Creator”
  receives no management key. The legacy management markers (`org.manage`,
  `member.manage`, `role.builder`, `group.manage`) left the entitlement catalog in
  2b-7 — they are permissions now — so a seat plan, which must be all-`seatEligible`,
  can no longer carry them and no admin-only strip is needed. The case's step 1
  assigns a seat to a member, so the spec asserts the member path and pins that no
  org-scoped entitlement arrives through the seat beyond the ceiling.
