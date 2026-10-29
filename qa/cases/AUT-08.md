# AUT-08 — Logowanie – niepoprawne dane

- id: AUT-08
- priority: P1 krytyczny
- module: AUT – Uwierzytelnianie i sesja
- section: Logowanie
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Wpisz student1@dev.local i hasło „zlehaslo”. Kliknij „Zaloguj się”.
2. Wpisz nieistniejący e-mail nobody@dev.local z dowolnym hasłem.
3. Zostaw puste pola i kliknij „Zaloguj się”.
4. Wpisz STUDENT1@DEV.LOCAL / pass.

## Expected result

- Dla błędnych danych toast/komunikat „Nieprawidłowy adres e-mail lub hasło.” – identyczny dla złego hasła i nieistniejącego konta (brak ujawniania, które istnieje).
- Puste pola → komunikaty „Adres e-mail jest wymagany.” i „Hasło jest wymagane.”
- Wielkość liter w e-mailu: zanotuj, czy logowanie się powiodło (oczekiwane: tak).

## Suite seed — tenant model (reconciled)

The case was written against the legacy manual seed (`student1@dev.local` / `pass`),
whose student account is not part of the QA-suite tenant model. The suite version
keeps the case's steps and expected copy, and maps them onto the case's own tenant:

- Case tenant (deterministic):
  `tenantKey('qa/cases/AUT-08.md', 'AUT-08', 'qa-shared')` → `AUT-08.md::AUT-08::qa-shared`
- Seed: `bun scripts/qa-tenant.ts AUT-08` against the shared Supabase (`content`
  profile: organisation `qa-aut-08-<run>` with manager/teacher/student, password
  `Seed4Test!`). Each independent verification run uses `--fresh`, which folds a run
  suffix into the key and writes it to `qa/.tenants/AUT-08.json`.
- `student1@dev.local` → the tenant's seeded `student` user. Its e-mail and password
  come from the fixture, never from a hard-coded address.
- `nobody@dev.local` → a per-run address derived from the tenant key
  (`qa+<shortHash(key)>+ghost@test.local`), so it can never collide with a seeded
  account or with another worker's tenant.
- Step 4 types the tenant student's e-mail in upper case with its real password —
  the same account, different casing.
- Spec: `__tests__/qa/AUT/AUT-08.spec.ts`, project `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`.
- Isolation: every test runs in a fresh browser context (no session, as the
  prerequisite requires). The only writes are the login attempts themselves; nothing
  global (admin setting, feature flag, plan, platform stat, singleton row) is read or
  written, and no other tenant's data is touched.

## Observed during the suite walk (qa-env-6, shared app 3010 / DB 54421)

- `/login` renders in Polish without a session: card title „Witaj ponownie”, fields
  „Adres e-mail” and „Hasło”, button „Zaloguj się”. The page stays `/login` on every
  failed attempt.
- Wrong password for an existing account („zlehaslo”) → red toast
  „Nieprawidłowy adres e-mail lub hasło.” (`[data-sonner-toast][data-type="error"]`),
  API `POST /api/v1/auth/login` → `401` `{"success":false,"error":"UNAUTHORIZED"}`,
  no session (`/api/v1/auth/me` → `user: null`) and no auth cookie.
- Unknown account (`nobody@dev.local`) → the exact same toast, the exact same `401`
  `UNAUTHORIZED` body. Nothing distinguishes the two cases.
- Empty form → two inline field messages (not a toast): „Adres e-mail jest wymagany.”
  and „Hasło jest wymagane.”, and **no** request to `/api/v1/auth/login`.
- A malformed address („not-an-email”) → inline „Wprowadź poprawny adres e-mail.”,
  no password message and **no** API request (client-side `LoginSchema`).
- Upper-case e-mail with the correct password → login succeeds (`200`,
  `success: true`), an auth cookie (`sb-localhost-auth-token`) is set and the student
  lands on `/app`. The API response normalises the address to lower case.
