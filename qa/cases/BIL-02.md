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

- Student i nauczyciel widzą tę samą, jedną drabinkę indywidualną: Free, Plus, Pro, Max.
- Aktualny plan oznaczony jako „Twój plan”, pozostałe z przyciskami zakupu/wyboru.

> Kontrakt (2026-11-24, ADR-0015 §7.1; zaktualizowany #1193): trasa planów nie jest
> bramką persony — oba adresy otwierają się dla każdego zalogowanego konta i adres
> pozostaje bez zmian. Persona nie filtruje też zakupu planu osobistego: jedna
> drabinka obsługuje studenta i edukatora.

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
  default group `G1`), declared in `__tests__/qa/profiles/BIL-02.json`. Both legs of the case
  need an account, so the profile is the default one.
- **Users**: the tenant's `student` (password `Seed4Test!`) is the „student1” leg. The
  tenant's `teacher` (an `educator` account) is the „teacher1” leg.
- **Plans the two legs start on**: the student is an org member without a seat
  assignment, so `/api/v1/me/personal-plan` resolves their personal plan
  (`profiles.personal_plan_key`, default `base`). The teacher has no seat assignment
  either, so `/api/v1/me/plan` falls back to the same personal plan — `base`, written by
  the `handle_new_user` trigger for every account type since #1193. `--plan` is not needed.
- **Read-only shared data**: the plan catalogue (`subscription_plans`, `plan_limits`) is
  global. The case can only exist against it, so the spec reads it through
  `/api/v1/subscription-plans?scope=personal` and asserts the page renders it; nothing
  global is written. The only write is the mock checkout session the purchase button
  creates for this tenant's own student.

## Walk observations (shared app, pl)

- Both pages share one shell: heading „Rozwiń swój plan” and subtitle „Wybierz plan
  odpowiedni dla Twoich potrzeb”, followed by a four-column grid of plan cards.
- `/app/upgrade` (student) and `/edu/upgrade` (educator) show the same individual
  catalogue in catalogue order: StudiQ Free (0 zł, features Fiszki/Testy, „Zacznij za
  darmo”), StudiQ Plus (19,99 zł/miesiąc, „Wybierz Plus”, „Zalecany”), StudiQ Pro
  (39,99 zł/miesiąc, „Wybierz Pro”), StudiQ Max (79,99 zł/miesiąc, „Wybierz Maks”).
  The Free card carries the „Twój plan” badge on both pages.
- The purchase buttons are live: „Wybierz Plus” creates a mock checkout session and
  opens `/checkout?session_id=…&plan_id=spark` („Podsumowanie zamówienia”, „StudiQ
  Plus”).
- Persona no longer filters the ladder or the purchase: a signed-in student opening
  `/edu/upgrade` keeps the URL and sees the same individual plans, and can start a
  personal checkout from there. `/app` and `/edu` require only a session
  (ADR-0015 §7.1), so neither page redirects.
- The behavior matches the case exactly; no defect to report.
