# AUT-14 — Wylogowanie

- id: AUT-14
- priority: P1 krytyczny
- module: AUT – Uwierzytelnianie i sesja
- section: Reset hasła, wylogowanie, sesja
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany jako student1.

## Seed (reconciled with the tenant seeder)

The manual seed account (`student1@dev.local`, password `pass`) is replaced by this
case's own tenant, seeded before each independent run:

```bash
bun scripts/qa-tenant.ts AUT-14 --profile content --fresh
```

`content` gives the case one organization plus its manager, one educator and the
**student under test** (`users.student`). Every id derives from
`tenantKey('qa/cases/AUT-14.md', 'AUT-14#<run>', 'qa-shared')` + `tenantId`, the
`--fresh` run suffix makes each independent run a new tenant, and the student signs
in through the real login form with the seeded `Seed4Test!` password. Nothing
global (admin settings, feature flags, plans, platform rows) is read or written.

## Steps

1. Kliknij avatar/nazwę użytkownika w dolnej części paska bocznego.
2. Wybierz „Wyloguj się”.
3. Naciśnij przycisk „Wstecz” przeglądarki.

## Expected result

- Przekierowanie na /login.
- Po cofnięciu strony chronione (/app) nie są dostępne bez ponownego logowania – następuje przekierowanie na /login.
