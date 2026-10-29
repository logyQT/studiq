# AUT-05 — Rejestracja na istniejący e-mail

- id: AUT-05
- priority: P2 ważny
- module: AUT – Uwierzytelnianie i sesja
- section: Rejestracja
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Konto student1@dev.local istnieje.

## Steps

1. Spróbuj zarejestrować się z e-mailem student1@dev.local.

## Expected result

- Brak utworzenia duplikatu. Komunikat (np. „Wystąpił konflikt. Zasób może już istnieć.” lub neutralny komunikat o wysłaniu linku – zanotuj faktyczny).
- Komunikat nie powinien ujawniać szczegółów technicznych ani stack trace.

## Suite seed — tenant model (reconciled)

The case was generated against the legacy manual seed (`student1@dev.local`). The
suite version needs one **already existing, e-mail-confirmed** account — that is
exactly what a case tenant provides, so it uses the default `content` profile:

- Case tenant (deterministic):
  `tenantKey('qa/cases/AUT-05.md', 'AUT-05#<run>', 'qa-shared')`
  → `AUT-05.md::AUT-05#<run>::qa-shared`
- Seed: `bun scripts/qa-tenant.ts AUT-05 --fresh` against the shared Supabase. It
  creates an organisation, its manager/teacher/student and a default group
  (`seed-<role>-<hash>@dev.local`, password `Seed4Test!`). Accounts are created
  through the Supabase Admin API with `email_confirm: true`, which is the state
  GoTrue rejects as `user_already_exists`. The spec reads the tenant from
  `qa/.tenants/AUT-05.json`; it never creates tenant accounts itself.
- Spec: `__tests__/qa/AUT/AUT-05.spec.ts`, project `qa/playwright.qa.config.ts`,
  baseURL `http://localhost:3010`.
- Isolation: the visitor is anonymous, and the only data the spec touches is
  the tenant's own student account (its address and login) plus one fresh
  address derived from the tenant key. No global settings, feature flags, plans
  or singleton rows are read or written.

## Observed during the suite walk (qa-env-5, shared app 3010 / DB 54421)

- `/register` is public; the form has „Imię i Nazwisko”, „Adres e-mail”, the
  required „Jestem” combobox („Uczniem” / „Nauczycielem” / „Menedżerem”) and
  „Hasło”. Without an account type the form does not submit.
- Submitting the existing tenant student's address (with a different password)
  returns HTTP **202** and `{"success":true,"data":{"message":"SUCCESS_ACTIVATION_LINK_SENT"}}`.
  The card flips to „Konto zostało utworzone” / „Prawie gotowe! Brakuje jeszcze
  tylko jednego kroku.” / „Link aktywacyjny został wysłany. Sprawdź swoją
  skrzynkę e-mail.” with the button „Przejdź do logowania”. The URL stays
  `/register`.
- No conflict error, no `x-error-code`, no stack trace and no technical detail
  are shown — the neutral link-sent message is the actual behaviour (the case's
  first allowed outcome), and it is identical to a fresh registration.
- The existing account is untouched: exactly one `profiles` row exists for the
  address with the same id, and `POST /api/v1/auth/login` still succeeds with the
  original password and the same user id / `account_type: student`, while the
  password submitted in the duplicate form is rejected (`401 UNAUTHORIZED`).
  Creating a duplicate is therefore prevented (`#300`). The spec asserts this
  through the product (both logins), not by reading the database.
