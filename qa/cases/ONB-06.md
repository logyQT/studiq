# ONB-06 — Student – dołączenie do klasy kodem (/app/join)

- id: ONB-06
- priority: P2 ważny
- module: ONB – Onboarding, organizacje i zaproszenia
- section: Student – dołączenie do klasy, przełączanie organizacji
- prereqs: MGR-INV-01
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Student3 + świeże zaproszenie dla jego e-maila (MGR-INV-01 z rolą „member”).

## Prerequisite context

### MGR-INV-01 — Wysłanie zaproszenia z rolą

_Warunek wstępny: M1, WSB Merito (4/5 członków)._

1. Otwórz /manage/invites.
2. Wpisz e-mail invite1@example.com, wybierz rolę „member”.
3. Kliknij „Wyślij zaproszenia”.
4. W sekcji „Wyniki” kliknij „Kopiuj link”.

Expected:

- Toast „Wysłano 1 zaproszeń.”; w sekcji „Wyniki” plakietka „Sukces” i przycisk „Kopiuj link” (toast „Skopiowano!”).
- W tabeli „Wysłane zaproszenia” nowe zaproszenie ze statusem „Oczekujące”.
- W Inbucket brak wiadomości lub wiadomość z linkiem (zanotuj – jeżeli mail nie jest wysyłany, link kopiowany ręcznie).

## Steps

1. Wybierz „Dołącz do klasy” (lub otwórz /app/join).
2. Wklej kod zaproszenia i kliknij „Dołącz”.
3. Powtórz z niepoprawnym kodem.

## Expected result

- Poprawny kod → toast „Dołączyłeś do klasy!” i odświeżenie; przełącznik pokazuje nową organizację.
- Zły/wygasły kod → toast „Nieprawidłowy lub wygasły kod zaproszenia”.
- Puste pole – przycisk nie wysyła żądania.

## Prerequisite context (tenant model)

The verbatim prerequisite names the legacy manual seed („Student3”) and the
MGR-INV-01 manual flow. The automated case owns a seeded tenant instead:

- **Tenant key**: `tenantKey('qa/cases/ONB-06.md', 'ONB-06 student joins a class with an invite code', 'qa-shared')`
  plus a per-run suffix (`QA_RUN_SUFFIX`, otherwise fresh). Every org/user/role id
  is `tenantId(key, entity)`.
- **Organization**: one org with the default group; the seeded `manager` is its
  `admin` (the MGR-INV-01 inviter).
- **Users** (password `Seed4Test!`): `manager` (manager), `student` (student,
  **no organization** — the „Student3” substitute), `outsider` (student, **no
  organization**, used only for the bad-code path).
- **Invites**: two `member` invitations minted by the `manager` through
  `POST /api/v1/organization/invites` — the same request MGR-INV-01 makes, so the
  inviter authority, role scope and expiry are real. One is live; the other is
  backdated to an expired `expires_at` for the „wygasły kod” path.
- **Profile**: no decks/banks/quizzes; this case only touches the join surface.
- The spec seeds the graph at run time with the shared helpers
  (`__tests__/helpers/tenant-seed.ts`) because a valid invite is single-use: an
  out-of-band `qa/.tenants/ONB-06.json` could not be reused across runs.

## Walk observations (shared app, pl)

- An org-less student stays on `/app`; the standalone switcher shows „StudiQ /
  Student”, and its menu holds „Nie należysz do żadnej organizacji” and „Dołącz
  do klasy”. The latter opens `/app/join`.
- `/app/join` is a single card: title „Dołącz do klasy”, description „Wpisz kod
  zaproszenia lub wklej link zaproszenia, aby dołączyć do klasy”, field „Kod
  zaproszenia” (`#token`) and the „Dołącz” submit button, which stays disabled
  while the field is empty (Enter in the empty field sends no request).
- Valid code → toast „Dołączyłeś do klasy!”, the field is cleared and the
  switcher switches in place to the organization name (role shown as „Member”).
  There is no hard page reload; after a manual refresh the organization is still
  the active one. `GET /api/v1/me/orgs` returns exactly that org, role `member`,
  `isActive: true`.
- Unknown code `abc` → toast „Nieprawidłowy lub wygasły kod zaproszenia” and the
  same text in the inline alert under the field; the API answers `404 NOT_FOUND`.
  An expired code produces the same UI with `410 GONE`. Neither adds a
  membership.
- The page accepts a bare code or a pasted `/join?token=…` link.
