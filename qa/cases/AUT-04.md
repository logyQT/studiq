# AUT-04 — Walidacja imienia i nazwiska

- id: AUT-04
- priority: P2 ważny
- module: AUT – Uwierzytelnianie i sesja
- section: Rejestracja
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Wpisz imię: „A” ; „Jan123” ; „Anna-Maria Nowak” ; „Łukasz Żółć” ; „Jan O'Brien”.
2. Dla każdego uzupełnij pozostałe pola poprawnie i wyślij.

## Expected result

- „A” → „Imię i nazwisko jest za krótkie.”
- „Jan123” → „Imię i nazwisko zawiera niedozwolone znaki.”
- „Łukasz Żółć” (polskie znaki) → akceptowane.
- Zanotuj zachowanie dla „Anna-Maria Nowak” i „Jan O'Brien”: reguła dopuszcza wyłącznie litery i spacje, więc myślnik i apostrof mogą zostać odrzucone (potencjalny problem dla nazwisk dwuczłonowych – zgłoś jako uwagę).

## Prerequisite context (tenant model)

The verbatim prerequisite is „Brak sesji”. `/register` is public, so the automated
case runs in an empty storage state and never signs in. Its isolation anchor is
still its own tenant:

- **Tenant key**: `tenantKey('qa/cases/AUT-04.md', <title>, 'qa-shared')::<run suffix>`
  — a fresh suffix per independent run (or `QA_RUN_SUFFIX` to replay one run).
- **Rows**: none. The case asserts the anonymous registration form only, so no org,
  user, group or content row is needed; the spec derives each registration address
  from the key with `shortHash` (`qa+<hash>+aut04@test.local`) instead of colliding
  with another case's rows.
- **Profile**: none, so no entry is needed in `__tests__/qa/profiles/<CASE>.json`.
- **Password** for the created accounts: `Seed4Test!`.
- **Global state**: nothing is read or written — no settings, feature flags, plans,
  platform rows or another tenant.

## Walk observations (shared app, pl)

- `/register` renders „Utwórz konto”, fields „Imię i Nazwisko”, „Adres e-mail”,
  „Jestem” (combobox: Uczniem / Nauczycielem / Menedżerem), „Hasło” and the button
  „Zarejestruj się”.
- „A” → inline field error „Imię i nazwisko jest za krótkie.” (`NameSchema.min(2)`).
  No `POST /api/v1/auth/register` is sent; the form stays on `/register`.
- „Jan123” → inline field error „Imię i nazwisko zawiera niedozwolone znaki.”
  (`NameSchema` charset), again with no request.
- „Łukasz Żółć”, „Anna-Maria Nowak” and „Jan O'Brien” → accepted: the request is
  sent with the name unchanged, the API answers 202 and the card flips to
  „Konto zostało utworzone” / „Link aktywacyjny został wysłany…”. Correcting a
  rejected name clears the error and registers normally.
- The case's „zanotuj” note for the hyphen and the apostrophe is resolved in the
  product: `NameSchema` (packages/server/src/models/auth.model.ts) explicitly allows
  a hyphen for double-barrelled surnames and an ASCII/typographic apostrophe for
  Irish/English names (#302). Acceptance is therefore the intended behaviour, and
  the shared e2e contract (`__tests__/e2e/register.spec.ts`) already asserts it.
- No error toast appears for either negative name — the message is field-level, so
  the spec asserts it inside the name field's own form item.
- The success card is also what a duplicate address returns (neutral 202, AUT-05);
  acceptance is still asserted honestly because an invalid name never reaches the
  API (client resolver) and a name the server rejects yields an error toast instead
  of the card. The spec also checks the submitted request body's `name` matches
  what was typed, so the payload is not silently rewritten.
