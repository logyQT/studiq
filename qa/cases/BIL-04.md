# BIL-04 — Zakup planu organizacji przez managera

- id: BIL-04
- priority: P1 krytyczny
- module: BIL – Plany, rozliczenia i płatność (symulowana)
- section: Zakup planu (checkout)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

manager@dev.local, organizacja WSB Merito (Launch).

## Seed (reconciled with the tenant seeder)

The manual seed account (`manager@dev.local`, organization „WSB Merito (Launch)”,
password `pass`) is replaced by this case's own tenant, seeded before each
independent run:

```bash
bun scripts/qa-tenant.ts BIL-04 --fresh
```

`__tests__/qa/profiles/BIL-04.json` declares the default `content` profile: one
organization on the free `launch` plan (the DB default — no `--plan` override),
its `manager` (org role `admin`, account type manager) as the buyer, plus the
tenant's `teacher` and `student` and the default group `G1`. That is the case's
starting point: „organizacja WSB Merito (Launch)”, administered by its manager.
Every id derives from `tenantKey('qa/cases/BIL-04.md', 'BIL-04#<run>', 'qa-shared')`

- `tenantId`; `--fresh` gives each independent run its own organization, so the
  purchase never starts from an already-upgraded plan. All accounts use the seeded
  `Seed4Test!` password and sign in through the real login API.

The purchase writes only this tenant's own data: `organizations.plan` (through
`apply_org_plan`, which re-syncs the org feature snapshots) plus a `payments` row
for the buying manager. The plan catalogue (`subscription_plans`, `plan_limits`)
is shared and read-only — the spec reads it through the public API and never
changes it. No admin setting, feature flag, platform row, singleton or foreign
tenant is read or written.

## Steps

1. Wejdź na /pricing/org i wybierz „Hub” → zakup (checkout z kartą testową).
2. Po zakupie sprawdź /manage/settings (branding) i /manage/roles.

## Expected result

- Zakup przechodzi (komunikaty jak w BIL-03).
- WERYFIKUJ I ZGŁOŚ: z kodu wynika, że symulowany webhook zmienia wyłącznie plan OSOBISTY użytkownika (profiles.personal_plan_key), a NIE plan organizacji. Oczekiwane (zgodnie ze specyfikacją): organizacja przechodzi na Hub i odblokowuje branding oraz kreator ról. Jeśli po zakupie organizacja nadal ma Launch (karta blokady brandingu widoczna), zgłoś jako defekt funkcjonalny.

## Walk observation (shared app, pl)

The concern the case asks to verify does **not** reproduce on the current build.
The mock webhook (`mock-stripe.service.ts`) treats a plan whose
`subscription_plans.for_account_type` is `manager` as an organization plan: it
requires the caller to be an admin of the target organization (`assertOrgAdmin`)
and calls `apply_org_plan`, which moves `organizations.plan` and re-syncs the
organization's feature snapshots. The buyer's `profiles.personal_plan_key` is
deliberately left on the free `launch` tier (#228) — the organization purchase
never becomes a personal plan.

Confirmed end to end on this case's tenant:

- `/pricing/org` lists Launch as „Obecny Plan” and offers „Wybierz Hub”; the CTA
  creates a checkout session for the tenant's organization, and `/checkout`
  shows „Dla: <organizacja>”, „StudiQ Hub”, 19,99 zł/mies., „Razem” and the
  „Zabezpieczone przez StudiQ Pay…” warning.
- Paying with the test card shows „Płatność udana! Przekierowywanie...”, then
  „Zakup udany!”, then the manager panel.
- `GET /api/v1/organization/<id>` reports `plan: "hub"`, `GET /api/v1/me/plan`
  reports Hub with the `branding` and `role.builder` features, and
  `GET /api/v1/me/payments` gains one Hub row (19,99 PLN).
- `/manage/settings` shows „StudiQ Hub” and the unlocked controls („Wgraj logo”,
  „Kolor marki”) — the „Własny branding” lock card is gone.
- `/manage/roles` shows „Nowa rola” — the „Kreator ról nie jest dostępny w Twoim
  planie” lock card is gone.
- The manager's personal plan stays Launch before and after the purchase.
- A teacher of the same organization cannot buy the plan: `/checkout` answers
  with „Tylko administrator organizacji może kupić plan” and no payment form,
  and `POST /api/v1/stripe/webhook` returns `403 FORBIDDEN`, leaving the
  organization plan untouched.
