# STU-51 — Zmiana hasła w koncie

- id: STU-51
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Konto studenta (/app/account)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Konto TS (hasło pass).

## Seed — tenant model (reconciled with the suite seeder)

The legacy prerequisite names the manual seed account `test-student@dev.local` („TS”,
password `pass`) and step 4 ends with „PRZYWRÓĆ «pass»” so the shared manual account keeps
working for the next tester. The automated case never uses that account; it runs on its own
tenant:

```bash
bun scripts/qa-tenant.ts STU-51 --fresh
# qa/tests/profiles/STU-51.json → {"profile": "bare", "role": "student"}
```

- Tenant key: `STU-51.md::STU-51#<run suffix>::qa-shared` —
  `tenantKey('qa/cases/STU-51.md', 'STU-51#<run suffix>', 'qa-shared')`, the same scheme as
  the e2e fixtures (no QA-only ID scheme).
- Account: the `bare` profile's student — no organization and no group, confirmed e-mail,
  starting password `Seed4Test!` (the tenant-seed default, the equivalent of the document's
  „pass”). `--fresh` guarantees a brand-new account per independent run, so the starting
  password is always the seeded one and „the old password” is well defined.
- Nothing else is needed: `/app/account` is account-scoped, so the case needs no org, group,
  deck or assignment. Object ids come from `tenantId(key, entity)`; the spec hard-codes no
  UUID.
- The „PRZYWRÓĆ «pass»” note applies to the shared manual account. Here the run restores the
  tenant's own seeded password (`Seed4Test!`) at the end so a re-run/retry on the same
  CI-seeded tenant starts from the same state; no other tenant is touched.
- The new password is deterministic per tenant („Nowe1234” + a short hash of the tenant key)
  instead of the literal „Nowe1234”, so a repeat run never collides with the existing
  password (Supabase `same_password` → 422) while the confirmation mismatch stays different
  from the new password.
- Isolation: the spec reads and writes no global admin setting, feature flag, plan, platform
  stat or singleton row.

## Steps

1. W sekcji „Zmień hasło” wpisz obecne hasło „pass”, nowe „Nowe1234”, potwierdzenie „Inne1234” → zapisz.
2. Popraw potwierdzenie i zapisz.
3. Spróbuj podać błędne obecne hasło.
4. Wyloguj i zaloguj nowym hasłem; PRZYWRÓĆ „pass”.

## Expected result

- Niezgodne hasła → „Hasła nie są zgodne”.
- Poprawna zmiana → „Hasło zaktualizowane pomyślnie”.
- Błędne obecne hasło → odrzucenie z komunikatem (zanotuj treść).
- Nowe hasło musi spełniać reguły (min. 8 znaków, wielka litera, cyfra).

## Observations from the walk (shared app :3010, Polish UI, worker qa-env-3, 2026-10-29)

- `/app/account` is „Konto” / „Zarządzaj ustawieniami konta”. The password card is titled
  „Zmień hasło” with the inputs „Obecne hasło” (`#currentPassword`), „Nowe hasło”
  (`#newPassword`) and „Potwierdź hasło” (`#confirmPassword`), the static hint „Hasło musi
  mieć co najmniej 8 znaków, zawierać wielką literę i cyfrę.” and the button „Zaktualizuj
  hasło”. The button stays disabled until all three fields are non-empty.
- Step 1 (mismatched confirmation): the check is client-side — the toast „Hasła nie są
  zgodne” appears and **no** request reaches `POST /api/v1/auth/password/update`; the fields
  keep their values.
- Step 2 (correct confirmation): `POST /api/v1/auth/password/update` answers **200**
  (`{ success: true }`), the toast „Hasło zaktualizowane pomyślnie” appears and the three
  fields are cleared.
- Step 3 (wrong current password): the API answers **400** with
  `x-error-code: INVALID_CURRENT_PASSWORD` and the toast „Obecne hasło jest nieprawidłowe.”;
  the fields keep their values and the password does not change.
- Password rules (expected result, last bullet): a new password that breaks them
  (e.g. „slabe”) is refused with **422** `UNPROCESSABLE_ENTITY` carrying
  `issues.properties.password.errors = [VALIDATION_PASSWORD_TOO_SHORT,
VALIDATION_PASSWORD_MISSING_UPPERCASE, VALIDATION_PASSWORD_MISSING_NUMBER]`; the UI joins
  them into one toast: „Hasło musi mieć co najmniej 8 znaków. Hasło musi zawierać co
  najmniej jedną wielką literę. Hasło musi zawierać co najmniej jedną cyfrę.”
- Step 4: after `POST /api/v1/auth/logout` the `/login` form („Witaj ponownie”, fields
  `email` / `password`, button „Zaloguj się”) accepts the new password and lands on `/app`
  („Cześć, …”); the previous password is rejected with **401** `UNAUTHORIZED`.
- Restoring the seeded password through the same card answers 200 and shows „Hasło
  zaktualizowane pomyślnie” again. (Note: `Seed4Test!` satisfies the product's rules —
  ≥ 8 chars, an uppercase letter and a digit.)
