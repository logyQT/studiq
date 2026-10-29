# BIL-03 — Zakup planu studenta – ścieżka poprawna

- id: BIL-03
- priority: P1 krytyczny
- module: BIL – Plany, rozliczenia i płatność (symulowana)
- section: Zakup planu (checkout)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Konto TS (plan Base). Wejście przez /pricing/student lub /app/upgrade.

## Seed (reconciled with the tenant seeder)

The manual seed account (`test-student@dev.local`, password `pass`) is replaced by
this case's own tenant, seeded before each independent run:

```bash
bun scripts/qa-tenant.ts BIL-03 --profile bare --role student --fresh
```

`bare`/`student` reproduces the case's starting point exactly: one **student under
test** (`users.student`), no organization, no group, and the default free `base`
personal plan that the `handle_new_user` trigger writes. Every id derives from
`tenantKey('qa/cases/BIL-03.md', 'BIL-03#<run>', 'qa-shared')` + `tenantId`; the
`--fresh` suffix makes each independent run a new student, so the purchase never
begins from an already-upgraded plan. The student signs in through the real login
form with the seeded `Seed4Test!` password.

The purchase itself writes only this tenant's own data: `profiles.personal_plan_key`
for the student plus a `payments` row for that same user. The plan catalogue
(`subscription_plans`, `plan_limits`) is shared and read-only — the spec reads it
through the public API and never changes it. No admin setting, feature flag,
platform row or foreign tenant is read or written.

## Steps

1. Wybierz plan „Spark” → przycisk zakupu.
2. Na /checkout sprawdź podsumowanie zamówienia (nazwa planu, cena, „Razem”).
3. Wpisz numer karty 4242 4242 4242 4242, ważność 12/30, CVC 123, imię „Test Student”.
4. Kliknij „Zapłać 9,99 zł/miesiąc”.

## Expected result

- Pola formatują się automatycznie (spacje co 4 cyfry, „MM/RR” z ukośnikiem); przycisk „Zapłać” aktywny dopiero po wypełnieniu wszystkich pól (16 cyfr, 5 znaków ważności, 3 cyfry CVC, imię).
- Komunikat „Płatność udana! Przekierowywanie…”, po ok. 2 s strona „Zakup udany!” i po 3 s przejście do panelu.
- Plan użytkownika zmienia się na Spark (BIL-01: limity 500 fiszek, 200 pytań, 50 talii…).
- Ostrzeżenie na stronie: „Zabezpieczone przez StudiQ Pay; brak rzeczywistych opłat w trybie deweloperskim”.
