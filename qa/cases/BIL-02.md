# BIL-02 — Strona „Wybierz plan” (/app/upgrade, /edu/upgrade)

- id: BIL-02
- priority: P2 ważny
- module: BIL – Plany, rozliczenia i płatność (symulowana)
- section: Aktualny plan i strony rozliczeń
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany student1, następnie teacher1.

## Steps

1. Jako student1 otwórz /app/upgrade.
2. Jako teacher1 otwórz /edu/upgrade.

## Expected result

- Student widzi plany typu student (Base, Spark, Ace, Pro); nauczyciel – edukatora (Lite, Guide, Creator, Master).
- Aktualny plan oznaczony jako „Obecny Plan”, pozostałe z przyciskami zakupu/wyboru.

## Seed (reconciled with the tenant seeder)

The verbatim prerequisite names the legacy manual accounts `student1@dev.local` and
`teacher1@dev.local` (password `pass`). The automated case uses its own tenant instead
and never signs in as a seed account:

```bash
bun scripts/qa-tenant.ts BIL-02 --fresh   # new org + users per independent run
```

- **Tenant key**: `tenantKey('qa/cases/BIL-02.md', 'BIL-02#<run>', 'qa-shared')`; with
  `--fresh` the title carries a run suffix, so every independent run gets brand-new
  (still deterministic) ids via `tenantId(key, entity)`.
- **Profile**: `content` (org `qa-bil-02-<suffix>`, manager `admin`, teacher, student,
  default group `G1`), declared in `qa/tests/profiles/BIL-02.json`. Both legs of the case
  need an account, so the profile is the default one.
- **Users**: the tenant's `student` (password `Seed4Test!`) is the „student1” leg. The
  tenant's `teacher` (an `educator` account) is the „teacher1” leg.
- **Plans the two legs start on**: the student is an org member without a seat
  assignment, so `/api/v1/me/personal-plan` resolves their personal plan
  (`profiles.personal_plan_key`, default `base`). The teacher has no seat assignment
  either, so `/api/v1/me/plan` falls back to the same personal plan — `lite`, written by
  the `handle_new_user` trigger for `account_type = educator`. `--plan` is not needed.
- **Read-only shared data**: the plan catalogue (`subscription_plans`, `plan_limits`) is
  global. The case can only exist against it, so the spec reads it through
  `/api/v1/subscription-plans?for=<accountType>` and asserts the page renders it; nothing
  global is written. The only write is the mock checkout session the purchase button
  creates for this tenant's own student.

## Walk observations (shared app, pl)

- Both pages share one shell: heading „Rozwiń swój plan” and subtitle „Wybierz plan
  odpowiedni dla Twoich potrzeb”, followed by a four-column grid of plan cards.
- `/app/upgrade` (student) shows exactly the student catalogue in catalogue order:
  StudiQ Base (0 zł, features Fiszki/Testy, „Zacznij za Darmo”), StudiQ Spark
  (9,99 zł/miesiąc, „Przejdź na Spark”), StudiQ Ace (19,99 zł/miesiąc,
  „Najpopularniejszy”, „Wybierz Ace”), StudiQ Pro (49,99 zł/miesiąc, „Wybierz Pro”).
  The Base card carries the „Obecny Plan” badge.
- `/edu/upgrade` (educator) shows exactly the educator catalogue: StudiQ Lite (0 zł,
  „Zacznij za Darmo”), StudiQ Guide (9,99 zł/miesiąc, „Przejdź na Guide”), StudiQ Creator
  (19,99 zł/miesiąc, „Najpopularniejszy”, „Wybierz Creator”), StudiQ Master
  (49,99 zł/miesiąc, „Wybierz Master”). The Lite card carries the „Obecny Plan” badge.
- Each page shows only its own account type's plans; no student plan appears on the
  educator page and vice versa.
- The purchase buttons are live: „Przejdź na Spark” creates a mock checkout session and
  opens `/checkout?session_id=…&plan_id=spark` („Podsumowanie zamówienia”, „StudiQ
  Spark”).
- Account-type gating holds: a signed-in student opening `/edu/upgrade` lands on `/app`,
  an educator opening `/app/upgrade` lands on `/edu`.
- The behavior matches the case exactly; no defect to report.
