# AUT-11 — Zalogowany użytkownik na /login i /register

- id: AUT-11
- priority: P2 ważny
- module: AUT – Uwierzytelnianie i sesja
- section: Logowanie
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany jako teacher1.

## Steps

1. Otwórz /login.
2. Otwórz /register.

## Expected result

- Oba adresy przekierowują natychmiast do panelu odpowiedniego dla typu konta (/edu).

## Suite seed — tenant model (reconciled)

The case was written against the legacy manual seed (`teacher1@dev.local`, `pass`). The
suite never signs in as a legacy account; it uses the case's own isolated tenant:

- Tenant key: `tenantKey('qa/cases/AUT-11.md', 'AUT-11#<run>', 'qa-shared')` — every id
  (organization, default group, users) is an RFC-4122 UUIDv5 derived from that key.
- Seed: `bun scripts/qa-tenant.ts AUT-11 --profile content --fresh` against the shared
  Supabase (`qa/env.json` → `http://localhost:54421`). `content` creates one organization
  with a manager (admin), an educator, a student and the default group — the minimum
  needed to exercise all three account-type branches of the redirect, not just `/edu`.
- Accounts: `tenant.users.teacher` is the case's `teacher1` (educator, the subject of the
  case); `tenant.users.manager` and `tenant.users.student` are the adjacent branches. All
  use the seeded password `Seed4Test!` from `tenant-seed.ts`, never `pass`.
- `--fresh` gives every independent run a new run suffix, so each run owns a brand-new
  tenant while every id stays derived from `qa/.tenants/AUT-11.json`; the spec contains no
  hard-coded UUID.
- Spec: `__tests__/qa/AUT/AUT-11.spec.ts`, project `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`.
- Isolation: the spec writes nothing. It signs in through `POST /api/v1/auth/login` and
  reads `GET /api/v1/auth/me`. No global admin setting, feature flag, plan, platform stat
  or singleton row is touched.

## Observed during the suite walk (qa-env-7, shared app 3010 / DB 54421)

- `/login` and `/register` are public for an anonymous visitor: both answer `200` and
  render their own form („Witaj ponownie” / „Utwórz konto”).
- For a signed-in educator, `GET /login` and `GET /register` answer `307` with
  `Location: /edu` **before** any document renders (`NextResponse.redirect` in
  `apps/web/src/proxy.ts`); the browser lands on the teacher panel („Panel Nauczyciela”).
  That is the „natychmiast” of the case — the login/register form never flashes.
- The same rule covers the other account types: manager → `/manage` („Zarządzanie
  Uczelnią”), student → `/app` („Moja Nauka”). The case names only the teacher branch;
  its `/edu` is the teacher panel.
- A safe internal `?next=` target is preserved by the redirect (AUT-09); this case passes
  none, so the account-type dashboard is always the destination.
- The session behind the redirect is the tenant's own account: `GET /api/v1/auth/me`
  returns the seeded e-mail and `app_metadata.account_type` = `educator`.
