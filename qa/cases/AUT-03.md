# AUT-03 — Walidacja hasła – reguły

- id: AUT-03
- priority: P2 ważny
- module: AUT – Uwierzytelnianie i sesja
- section: Rejestracja
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Wpisz poprawne imię, e-mail i typ konta. Kolejno wpisz hasła: „abc” ; „abcdefgh” ; „Abcdefgh” ; „abcdefg1” ; 129 znaków „Aa1…”.
2. Po każdym kliknij „Zarejestruj się”.

## Expected result

- „abc” → „Hasło musi mieć co najmniej 8 znaków.”
- „abcdefgh” → brak wielkiej litery („…co najmniej jedną wielką literę.”) i/lub cyfry.
- „Abcdefgh” → „…co najmniej jedną cyfrę.”
- „abcdefg1” → „…co najmniej jedną wielką literę.”
- 129 znaków → „Hasło nie może przekraczać 128 znaków.”

## Suite seed — tenant model (reconciled)

The case was generated against the legacy manual seed, but its prerequisite is
"Brak sesji" and every assertion lives on the public `/register` form. The suite
version therefore needs no tenant user, organisation or content row — only the
shared app and a fresh browser context (empty cookie jar). The case tenant is
bookkeeping that gives the run a deterministic, isolated identity:

- Case tenant (deterministic):
  `tenantKey('qa/cases/AUT-03.md', 'AUT-03', 'qa-shared')` → `AUT-03.md::AUT-03::qa-shared`
- Seed: `bun scripts/qa-tenant.ts AUT-03` against the shared Supabase (org
  `qa-aut-03-<run>`, manager/teacher/student, password `Seed4Test!`). Each
  independent verification run uses `--fresh`, which folds a run suffix into the
  key and writes it to `qa/.tenants/AUT-03.json`.
- The spec consumes no seeded account: it only derives the form's e-mail from
  `tenant.key` (`qa+<shortHash(key)>+register@test.local`), so a run can never
  collide with a seeded user or with another worker's tenant.
- Spec: `qa/tests/AUT/AUT-03.spec.ts`, project `qa/playwright.qa.config.ts`,
  baseURL `http://localhost:3010`.
- Isolation: invalid passwords are rejected client-side by `RegisterSchema`, so
  no request reaches `POST /api/v1/auth/register` and nothing is written. The two
  boundary tests (8 and 128 characters) intercept that route in the browser, so
  they prove the rule without creating an account. No global setting, feature
  flag, plan or singleton row is read or written.

## Observed during the suite walk (qa-env-6, shared app 3010 / DB 54421)

- `/register` is public and renders the Polish form by default: card title
  „Utwórz konto”, subtitle „Dołącz do StudiQ i rozpocznij naukę”, fields
  „Imię i Nazwisko”, „Adres e-mail”, „Jestem” (select: „Uczniem”,
  „Nauczycielem”, „Menedżerem”), „Hasło”, button „Zarejestruj się”.
- Validation runs on submit, not on change, and the message replaces the previous
  one under the password field (`data-slot="form-message"`); it is not a toast and
  the URL stays `/register`.
- Exact messages seen, in the case's order:
  - „abc” → „Hasło musi mieć co najmniej 8 znaków.”
  - „abcdefgh” → „Hasło musi zawierać co najmniej jedną wielką literę.” (the
    missing-uppercase rule is reported first; the digit rule is not shown on the
    same submit, which the case allows with „i/lub”)
  - „Abcdefgh” → „Hasło musi zawierać co najmniej jedną cyfrę.”
  - „abcdefg1” → „Hasło musi zawierać co najmniej jedną wielką literę.”
  - 129 znaków („Aa1” × 43) → „Hasło nie może przekraczać 128 znaków.”
- No `POST /api/v1/auth/register` request is made for any of the five rejected
  passwords (React Hook Form blocks the submit once `RegisterSchema` fails).
- Boundary values are accepted: „Abcdefg1” (8 characters, uppercase + digit) and
  a 128-character password both pass client validation and submit the form.
