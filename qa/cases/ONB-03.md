# ONB-03 — Dołączenie nauczyciela do istniejącej organizacji kodem

- id: ONB-03
- priority: P2 ważny
- module: ONB – Onboarding, organizacje i zaproszenia
- section: Nauczyciel – konfiguracja klasy
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Kod/token zaproszenia z MGR-INV (rola „teacher”); konto nauczyciela bez organizacji.

## Steps

1. Na /setup wybierz „Dołącz do istniejącej organizacji”.
2. Wklej kod zaproszenia w polu „Kod zaproszenia”.
3. Sprawdź podgląd „Zostałeś zaproszony do …” i kliknij „Dołącz do organizacji”.
4. Powtórz z nieprawidłowym kodem „abc”.

## Expected result

- Poprawny kod → podgląd nazwy organizacji, przycisk „Dołącz do organizacji”, po akceptacji przejście do panelu /edu z organizacją w przełączniku.
- Zły kod → „Ten kod zaproszenia jest nieprawidłowy lub wygasł.”

## Prerequisite context (tenant model)

The verbatim prerequisite names the legacy manual seed. The automated case owns a
seeded tenant instead:

- **Tenant key**: `tenantKey('qa/cases/ONB-03.md', 'ONB-03 join an existing organization with an invite code', 'qa-shared')`
  plus a per-run suffix (`QA_RUN_SUFFIX`, otherwise fresh). Every org/user/role id is
  `tenantId(key, entity)`.
- **Organization**: one org with the default group; the seeded manager is its `admin`.
- **Users** (password `Seed4Test!`): `manager` (manager), `invitee` (educator, **no
  organization**), `outsider` (educator, **no organization**, used only for the bad-code
  path).
- **Invite**: one live invitation for `invitee`, role `teacher`, minted by the `manager`
  through `POST /api/v1/organization/invites` — the same request MGR-INV makes, so the
  inviter authority, the role scope and the 7-day expiry are real.
- **Profile**: `bare` (no decks/banks/quizzes); this case only touches the onboarding
  surface.
- The spec seeds the graph at run time with the shared helpers
  (`__tests__/helpers/tenant-seed.ts`) because a valid invite is single-use: an
  out-of-band `qa/.tenants/ONB-03.json` could not be reused across runs.

## Walk observations (shared app, pl)

- Login as the org-less educator lands on `/setup` ("Witaj w StudiQ"); both options are
  present: „Dołącz do istniejącej organizacji” and „Utwórz własną klasę”.
- The join screen is `/setup/join`: heading „Dołącz do organizacji”, field label „Kod
  zaproszenia” (`#invite-code`), hint „Wklej kod lub link, który otrzymałeś od swojej
  organizacji.”
- Valid code → preview card: label „Zostałeś zaproszony do” (rendered uppercase by CSS,
  text unchanged), organization name, role badge `teacher` and the „Dołącz do
  organizacji” button. The preview alone does not join or consume the token.
- Accepting pushes `/edu`; the sidebar switcher shows the organization and `Teacher`, and
  `/setup` afterwards redirects to `/edu`.
- Invalid code `abc` → „Ten kod zaproszenia jest nieprawidłowy lub wygasł.” plus the
  secondary line „Nie udało się zweryfikować kodu. Spróbuj ponownie.” The membership list
  stays empty.
