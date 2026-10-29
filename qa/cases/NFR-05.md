# NFR-05 — Obsługa klawiaturą

- id: NFR-05
- priority: P2 ważny
- module: NFR – Wymagania niefunkcjonalne i międzyobszarowe
- section: Responsywność i dostępność
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Dowolna strona.

## Steps

1. Przejdź formularz logowania i rejestracji samym klawiaturą (Tab, Shift+Tab, Enter, Spacja).
2. Otwórz i zamknij okno dialogowe klawiszem Esc.
3. Sprawdź widoczność fokusu.

## Expected result

- Kolejność fokusu logiczna, fokus widoczny, Enter wysyła formularz, Esc zamyka okna, fokus wraca na element wyzwalający.

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`student1@dev.local`, password `pass`).
The suite version uses the case's own tenant and never the legacy accounts.

- Profile: `content` (`qa/tests/profiles/NFR-05.json`) — one organization, the default group
  `G1`, and one account per account type: `manager`, `teacher`, `student`.
- Seed: `bun scripts/qa-tenant.ts NFR-05 --fresh` — a fresh run suffix per independent run, so
  every run gets its own org/group/users from
  `tenantKey('qa/cases/NFR-05.md', 'NFR-05#<suffix>', 'qa-shared')` + `tenantId(key, entity)`.
  The spec reads the credentials through `loadTenant('NFR-05')`.
- Step 1 (`/login`, `/register`) is public: no session and no tenant row are needed. The login
  leg signs in as the tenant's `student` to prove Enter really submits; the registration leg
  submits an empty form (selecting an account type first), so no account is created and the
  run leaves no residue.
- Step 2 needs one dialog on an authenticated page: the tenant `student` opens
  `/app/flashcards` and uses the „Nowa talia” dialog. The dialog is opened and closed without
  saving, so the tenant's data is untouched.
- Step 3 measures the focus cue on the elements the steps reach: the two form fields and the
  submit button on `/login`, the account-type trigger on `/register`, and the dialog's close
  button and trigger.
- Not used: no other tenant, no global admin setting, feature flag, plan row/catalogue,
  platform stat or singleton row. Every test is re-runnable against an already-seeded tenant.

## Walk observations (shared app, worker qa-env-7, Polish UI)

- `/login` tab order: e-mail → password → „Zaloguj się” → „Zarejestruj się” (then the
  document body). Shift+Tab walks it backwards. Every stop draws the 3 px
  `ring-ring/50` ring; the two links fall back to the browser's 1 px `auto` outline.
- Enter in the password field posts `/api/v1/auth/login` (200) and lands on the student
  dashboard — the form is submitted, not just a client-side validation pass.
- `/register` tab order: name → e-mail → account type → password → „Zarejestruj się” →
  „Zaloguj się”. The account type is a Radix listbox: Space opens it and focus lands on the
  first option, Esc closes it without selecting and returns focus to the trigger, Space +
  ArrowDown + Enter selects „Nauczycielem” (form value `educator`) and returns focus.
- Enter in the register form submits it: with empty required fields the three validation
  messages (name, e-mail, password) render and the user stays on `/register` — no account is
  created.
- `/app/flashcards` → „Nowa talia”: Enter on the focused toolbar button opens the dialog,
  focus moves to the name field, Shift+Tab from that first stop wraps to the close button
  (focus is trapped inside), Esc closes the dialog and focus returns to the „Nowa talia”
  button with a visible ring. That restore is a deliberate product feature
  (`useRestoreFocusOnClose`, decision #190), not incidental Radix behaviour.
- The dialog's two text fields opt out of the ring (`focus-visible:ring-0`); their focus cue
  is a 1 px underline colour change. The spec therefore checks focus visibility on the
  dialog buttons/trigger, not on those two fields.
- Observations for triage, not asserted here:
  - „Nie pamiętasz hasła?” on `/login` is deliberately removed from the tab order
    (`tabIndex={-1}`), so a keyboard-only user cannot reach the password-reset flow. The
    spec's order helper tolerates one extra tab stop, so it does not encode either the
    presence or the absence of that link.
  - `FormControl` applies `aria-invalid` / `aria-describedby` to the wrapper `<div>` around
    the input (the `<label for>` still points at the input itself), so the field's error is
    not programmatically associated with the input. Screen-reader association, outside this
    case's keyboard steps.
  - The dialog close button's accessible name is a hardcoded English „Close” (sr-only) in
    every locale; it is product chrome, not translated copy.
