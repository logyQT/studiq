# ONB-09 — /join – brak tokenu, zły token, wygasły token

- id: ONB-09
- priority: P2 ważny
- module: ONB – Onboarding, organizacje i zaproszenia
- section: Zaproszenie przez link (/join?token=…)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Otwórz /join (bez parametru).
2. Otwórz /join?token=zlytoken.
3. Otwórz link zaproszenia, które zostało odwołane lub którego ważność (7 dni) minęła.

## Expected result

- Brak tokenu → natychmiastowe przekierowanie na /register.
- Zły token → toast z błędem i przekierowanie na /register.
- Odwołane/wygasłe zaproszenie → traktowane jak nieprawidłowe (przekierowanie, brak formularza).

## Suite seed — tenant model (reconciled)

The case is a **signed-out** visitor path (`Brak sesji`), so the visitor is always a
fresh browser context. Step 3 still needs a real invitation to revoke or expire, and
a real invitation needs a real inviter, so the case uses the default `content`
tenant profile:

- Case tenant (deterministic, fresh run suffix per run):
  `tenantKey('qa/cases/ONB-09.md', 'ONB-09#<suffix>', 'qa-shared')` →
  `ONB-09.md::ONB-09#<suffix>::qa-shared`
- Seed: `bun scripts/qa-tenant.ts ONB-09 --profile content --fresh` against the
  shared Supabase. It creates the org `qa-onb-09-<hash>` plus a manager (admin),
  teacher and student (`seed-*@dev.local`, password `Seed4Test!`). The spec reads
  them from `qa/.tenants/ONB-09.json`.
- Invitations are **not** seeded: each test mints its own rows through
  `POST /api/v1/organization/invites` as the tenant manager, and only ever reads
  back the tokens it created (invitee addresses `qa-onb-09-*@test.local`).
- Revocation is the product's own `DELETE /api/v1/organization/invites/:id` (the
  manage/invites „Anuluj zaproszenie?” action). Expiry has no API, so the spec
  backdates the one row it just created via the service client in
  `qa/fixtures/qa-db.ts`, matched by that row's token.
- Spec: `qa/tests/ONB/ONB-09.spec.ts`, project `qa/playwright.qa.config.ts`,
  baseURL `http://localhost:3010`.
- Isolation: every row the spec writes lives in this case's organization and is
  deleted or aged by the spec itself; nothing global (admin settings, feature
  flags, plans, platform stats, singleton rows) is read or written.

## Observed during the suite walk (qa-env-7, shared app 3010 / DB 54421)

- `/join` without `token`: the join card renders its „Verifying invitation…”
  skeleton for a moment, then the page is replaced with `/register`
  (`Utwórz konto`). No toast — there is nothing to report.
- `/join?token=zlytoken`: the page calls
  `GET /api/v1/organization/invites?token=zlytoken`, gets **404**, shows the sonner
  toast „Nieprawidłowy lub wygasły kod zaproszenia” and replaces the URL with
  `/register`. The toast lives in the root layout, so it survives the client-side
  navigation for its 4 s.
- A **revoked** invitation (row deleted by the manage/invites action) previews as
  **404**; an **expired** one (its `expires_at` in the past) previews as **410**.
  Both land on the same toast + `/register` treatment, and the join form (and its
  read-only invited address) never appears.
- A **live** invitation previews as **200** and renders the join card „Dołącz do
  organizacji” with the invited address pre-filled read-only and the „Aktywuj
  konto” button; the visitor stays on `/join?token=…`. This is the regression guard
  for the three rejection paths above.
- Copy is Polish by default (`NEXT_LOCALE` absent); the suite’s visitor context
  never sets that cookie.
