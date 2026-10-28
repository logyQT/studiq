# AUT-02 — Rejestracja nauczyciela i managera

- id: AUT-02
- priority: P2 ważny
- module: AUT – Uwierzytelnianie i sesja
- section: Rejestracja
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Zarejestruj konto „Test Nauczyciel” (test.teacher01@example.com, Haslo1234) z typem „Nauczycielem”.
2. Zarejestruj konto „Test Manager” (test.manager01@example.com, Haslo1234) z typem „Menedżerem”.
3. Aktywuj oba konta linkami z Inbucket i zaloguj się na każde.

## Expected result

- Nauczyciel po zalogowaniu trafia na /setup (konfiguracja klasy) – patrz ONB-01.
- Manager po zalogowaniu trafia na /setup/org – patrz ONB-04.
- Każdy typ konta ma w tokenie właściwy account_type (educator / manager).

## Suite seed — tenant model (reconciled)

The case was written against the legacy manual seed (`test.teacher01@example.com`,
`test.manager01@example.com`). A registration case has no pre-existing account by
definition, so the suite tenant contributes only the deterministic, run-suffixed
identity; the two accounts are created by the spec through `/register`:

- Case tenant (deterministic): `tenantKey('qa/cases/AUT-02.md', 'AUT-02#<run>', 'qa-shared')`.
- Seed: `bun scripts/qa-tenant.ts AUT-02 --profile bare --fresh` against the shared
  Supabase. `bare` is the no-organisation, first-run shape; nothing is created beyond
  the tenant itself. A **fresh run suffix per independent run** keeps the registrations
  new (the run itself creates the accounts).
- Accounts: both addresses are derived from the tenant key —
  `qa+<shortHash(key)>-educator@test.local` and `qa+<shortHash(key)>-manager@test.local`
  — with the case's password `Haslo1234`. No shared account is reused and no
  hard-coded UUID appears in the spec.
- Activation: the confirmation mail is read from the shared stack's mail catcher
  (`qa/fixtures/qa-mail.ts`, filtered to this run's own address) and the link is
  replayed against `QA_APP_URL`.
- Spec: `qa/tests/AUT/AUT-02.spec.ts`, project `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`.
- Isolation: the two fresh accounts own no organisation, group or content, and the
  spec only reads `GET /api/v1/auth/me` and `GET /api/v1/me/orgs`. Nothing global
  (admin settings, feature flags, plans, singletons) is touched.

## Observed during the suite walk (qa-env-4, shared app 3010 / DB 54421)

- `/register` is public for an anonymous visitor and titled „Utwórz konto”; the
  account-type control is a combobox labelled „Jestem” with exactly three options:
  „Uczniem”, „Nauczycielem”, „Menedżerem”.
- Submitting returns `202` (`SUCCESS_ACTIVATION_LINK_SENT`) and swaps the card to
  „Konto zostało utworzone” with „Link aktywacyjny został wysłany…” — no session is
  created yet, the account waits for the mailed link.
- The confirmation mail points at `{{ .SiteURL }}/auth/callback?token_hash=…&type=signup&next=/login`
  (`http://localhost:3010`), and opening it verifies the address and signs the new
  user in.
- The educator then ends on `/setup` („Witaj w StudiQ”); a later login through
  `/login` reaches the same place. `/manage` bounces the educator back to `/setup`.
- The manager ends on `/setup/org` („Skonfiguruj swoją organizację”); a later login
  reaches the same place, and `/edu` bounces the manager back to `/setup/org`.
- The access token carries `app_metadata.account_type` = `educator` / `manager`
  respectively (verified by decoding the session cookie's JWT).
