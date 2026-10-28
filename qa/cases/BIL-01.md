# BIL-01 — Strona rozliczeń studenta (/app/billing)

- id: BIL-01
- priority: P2 ważny
- module: BIL – Plany, rozliczenia i płatność (symulowana)
- section: Aktualny plan i strony rozliczeń
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany student1 (plan Base).

## Steps

1. Otwórz „Płatności” z menu użytkownika.

## Expected result

- Tytuł „Rozliczenia”, karta „Aktualny plan: StudiQ Base”, plakietka „Darmowy”.
- Lista funkcji (Fiszki, Testy) i limitów (m.in. Maks. fiszki 100, Maks. talie 10, Maks. pytania 50, Próby dziennie 10, Tokeny AI / dzień 0) bez „NaN”.
- Przycisk „Wybierz plan” prowadzi do /app/upgrade.

## Prerequisite context (tenant model)

The verbatim prerequisite names the legacy manual account `student1@dev.local`
(password `pass`). The automated case uses its own tenant instead and never signs in
as a seed account:

```bash
bun scripts/qa-tenant.ts BIL-01 --fresh   # new org + users per independent run
```

- **Tenant key**: `tenantKey('qa/cases/BIL-01.md', <title>, 'qa-shared')`; with
  `--fresh` the title carries a run suffix, so every independent run gets brand-new
  (still deterministic) ids via `tenantId(key, entity)`.
- **User**: the tenant's `student` (password `Seed4Test!`), seeded as an org `member`
  without a seat assignment, so `/api/v1/me/plan` resolves their **personal** plan —
  `profiles.personal_plan_key`, default `base` (#270/#181). That is the "plan Base"
  of the prerequisite; `--plan` is not needed.
- **Profile**: `content` (the default, so `qa/tests/profiles/BIL-01.json` needs no
  entry).
- **Read-only shared data**: the Base plan row and its features/limits are part of the
  global plan catalogue. The case can only exist against that catalogue, so the spec
  reads it through `/api/v1/me/plan` and mutates nothing (no admin settings, flags,
  plans or platform rows).

## Walk observations (shared app, pl)

- The user menu is the button in the sidebar footer (`[data-slot="sidebar-footer"]`),
  showing the student's name and e-mail; „Płatności” is the third entry.
- „Płatności” opens `/app/billing` with heading „Rozliczenia” and subtitle
  „Zarządzaj subskrypcją i danymi rozliczeniowymi”.
- One card „Aktualny plan” shows „StudiQ Base”, the „Darmowy” badge, the free price
  (`0,00 zł`), features „Fiszki” and „Testy”, then the limits: Maks. fiszki 100,
  Maks. talie 10, Maks. pytania 50, Maks. banki pytań 5, Próby dziennie 10,
  Tokeny AI / dzień 0. No value reads `NaN`.
- The organization-only limits (`Maks. studentów`, `Maks. grup`) are hidden on a
  student plan even though Base stores `-1` for them.
- „Wybierz plan” performs a full navigation to `/app/upgrade` (heading „Rozwiń swój
  plan”). The behavior matches the case exactly; no defect to report.
