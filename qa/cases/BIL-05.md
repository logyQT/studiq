# BIL-05 — Checkout – plan niezgodny z typem konta

- id: BIL-05
- priority: P1 krytyczny
- module: BIL – Plany, rozliczenia i płatność (symulowana)
- section: Zakup planu (checkout)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany student1.

## Seed (reconciled with the tenant seeder)

The manual seed account (`student1@dev.local`, password `pass`) is replaced by this
case's own tenant, seeded before each independent run:

```bash
bun scripts/qa-tenant.ts BIL-05 --fresh
```

`__tests__/qa/profiles/BIL-05.json` declares `bare`/`student`: one **student under test**
(`users.student`), no organization, no group, and the default free `base` personal
plan that the `handle_new_user` trigger writes. Every id derives from
`tenantKey('qa/cases/BIL-05.md', 'BIL-05#<run>', 'qa-shared')` + `tenantId`; the
`--fresh` suffix makes each independent run a new student who has never bought a
plan. The student signs in through the real login form with the seeded `Seed4Test!`
password.

The case's step targets the organization plan `campus`. The plan catalogue
(`subscription_plans`, `plan_limits`) is shared and read-only — the spec reads it
through the public API and never changes it. A rejected purchase writes nothing; the
positive control (the student's own `spark` plan) writes only this tenant's
`profiles.personal_plan_key` and its `payments` row. No admin setting, feature flag,
platform row or foreign tenant is read or written.

## Walk observation (shared app, pl)

Opening `/checkout?plan_id=campus` as this tenant's student shows the
„Podsumowanie zamówienia” with „StudiQ Campus” and the price, but instead of the card
form a blocking alert („Nie wiemy, dla której organizacji kupujesz plan”) with only
„Wróć do planów”. Posting the completed checkout for `campus` (organization plan) or
`lite` (educator plan) answers `403 FORBIDDEN` and leaves both the personal plan and
the payment history untouched; the same student's own `spark` purchase still goes
through. The concern from the case text does not reproduce — the intended rejection
is in place.

## Steps

1. Ręcznie otwórz /checkout?plan_id=campus (plan organizacji) i dokończ płatność testową.

## Expected result

- ZANOTUJ I ZGŁOŚ jeśli się powiedzie: z kodu wynika brak weryfikacji, czy plan pasuje do typu konta – student może przypisać sobie plan organizacyjny/edukatora (potencjalnie nadając uprawnienia). Oczekiwane: odrzucenie zakupu planu niezgodnego z typem konta.
