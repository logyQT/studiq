# STU-50 — Zmiana nazwy

- id: STU-50
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Konto studenta (/app/account)
- prereqs: tenant `content` (the case's own student account; nothing else)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Konto TS.

## Steps

1. Zmień nazwę na „Anna Nowak” i zapisz.
2. Odśwież stronę, sprawdź pasek boczny i powitanie na pulpicie.
3. Spróbuj zapisać nazwę „A” i „Anna123”.

## Expected result

- Toast „Nazwa zaktualizowana pomyślnie”; nowa nazwa widoczna w całej aplikacji po odświeżeniu.
- Nieprawidłowa nazwa → komunikaty „…za krótkie” / „…niedozwolone znaki”.

## Observed on the shared app (walk, qa-env-2)

- `/app/account` shows the header „Konto” / „Zarządzaj ustawieniami konta”, then the cards
  „Zdjęcie profilowe”, „Nazwa”, and „Zmień hasło”. The „Nazwa” card repeats the label
  „Nazwa”, the input `#name` (pre-filled with the stored name), the „Zapisz” button, the
  read-only „E-mail” field, and „Rola” / „Użytkownik od”.
- Saving „Anna Nowak” shows the sonner toast „Nazwa zaktualizowana pomyślnie” — exactly the
  case's copy. The sidebar user menu (`data-slot="sidebar-footer"`, bottom-left) switches to
  „Anna Nowak” immediately, the profile avatar takes the initials „AN”, and „Zapisz” becomes
  disabled because the form now matches the stored name.
- After a full reload the input, the sidebar and the account avatar still carry „Anna Nowak”.
  The dashboard (`/app`) greeting is „Cześć, Anna.” — the greeting uses the **first name**
  only (`hello_greeting`, „Cześć, {name}.”), while the sidebar shows the full name; both show
  the new name, i.e. it is persisted in `user_metadata.name` rather than cached client-side.
- „A” → toast „Imię i nazwisko jest za krótkie.”; the profile `PUT` answers 422 with
  `VALIDATION_NAME_TOO_SHORT` on the `name` field.
- „Anna123” → toast „Imię i nazwisko zawiera niedozwolone znaki.”; the `PUT` answers 422 with
  `VALIDATION_NAME_INVALID_FORMAT`.
- A rejected value stays in the input as an unsaved draft; the sidebar and the stored name
  remain „Anna Nowak”, and a reload still shows „Anna Nowak”. The name rules are the API's
  (`NameSchema`: min. 2 characters, letters plus space/hyphen/apostrophe), so the client only
  surfaces the returned code — the copy matches the case's „…za krótkie” /
  „…niedozwolone znaki”.

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`test-student@dev.local` / „TS”, password
`pass`, no content). The suite version uses the case's own tenant and never the legacy account.

- Profile: `content` (`qa/tests/profiles/STU-50.json`) — one organization, one default group
  `G1`, and one account per account type (`manager`, `teacher`, `student`). The spec signs in
  as `student`, the „TS” analogue; the case only touches that account's own profile.
- Seed: `bun scripts/qa-tenant.ts STU-50 --fresh` — a fresh run suffix per independent run, so
  every run gets its own org/group/users from
  `tenantKey('qa/cases/STU-50.md', 'STU-50#<suffix>', 'qa-shared')` + `tenantId(key, entity)`.
  The spec reads the ids through `loadTenant('STU-50')`.
- State: the student is seeded with the name „QA student”. Every execution resets the name to
  that value through `PUT /api/v1/auth/profile` before the walk (a valid, idempotent save), so
  a CI retry on the same tenant starts from the same first-run state as the first attempt.
- The rename, both rejected values, the sidebar/greeting checks and the reload all go through
  the UI, exactly as the case describes; the API is read afterwards only to confirm
  `user_metadata.name` and the validation code behind each toast.
