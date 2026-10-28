# MGR-ACC-01 — Menu użytkownika managera – Konto, Płatności, Wybierz plan

- id: MGR-ACC-01
- priority: P1 krytyczny
- module: MGR – Panel managera organizacji (/manage)
- section: Zgłoszenia i konto managera
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

M1. W kodzie istnieje tylko strona /manage/billing – brak /manage/account i /manage/upgrade.

## Steps

1. Otwórz menu użytkownika (dół paska bocznego).
2. Kliknij kolejno „Wybierz plan”, „Konto”, „Płatności”.

## Expected result

- „Płatności” → /manage/billing: strona rozliczeń z aktualnym planem.
- OCZEKIWANY DEFEKT DO POTWIERDZENIA: „Konto” (/manage/account) i „Wybierz plan” (/manage/upgrade) prowadzą do strony „Nie znaleziono strony” – manager nie ma ekranu zmiany nazwy/hasła ani wyboru planu. Zgłoś jako błąd (priorytet wysoki), jeśli potwierdzisz.
- Dla porównania: nauczyciel ma /edu/account i /edu/upgrade, student /app/account i /app/upgrade.

## Prerequisite context (tenant model)

The verbatim prerequisite ("only `/manage/billing` exists") describes the build the
case was written against. The automated case runs on the `content` tenant of its own
case instead:

```bash
bun scripts/qa-tenant.ts MGR-ACC-01 --fresh   # new org + users per independent run
```

- **Tenant key**: `tenantKey('qa/cases/MGR-ACC-01.md', <title>, 'qa-shared')` — with
  `--fresh` the title carries a run suffix, so each independent run gets brand-new,
  still deterministic ids (`tenantId(key, entity)`).
- **Organization**: one org whose seeded `manager` is its `admin`; the plan the billing
  page shows is that organization's plan, not a global row the case mutates.
- **Users** (password `Seed4Test!`): `manager` (manager, org `admin`), `teacher`
  (educator, org `member`) and `student` — the latter two only for the comparison path
  in the last bullet.
- **Plan catalogue**: read-only. The spec compares the upgrade grid and the billing
  badge with `/api/v1/subscription-plans` in the same run, so no plan name is pinned.
- **Profile**: `content` (the default, so no entry is needed in `qa/tests/profiles.json`).
- Neither the account page nor the menu mutates anything: the case is pure navigation,
  which is what makes it safe on the shared app.

## Walk observations (shared app, pl)

- The user menu is the button in the sidebar footer (`[data-slot="sidebar-footer"]`),
  showing the user's name and e-mail. It opens: „Wybierz plan”, „Konto”, „Płatności”,
  „Polski”, „English”, „Motyw”, „Wyloguj się”.
- The expected defect of the case **is no longer reproducible**: fix #453 added
  `/manage/account` and `/manage/upgrade`, and both open their own screen. The walk and
  the spec therefore assert the intended behaviour, and keep „Nie znaleziono strony” as
  a negative assertion instead of a positive one.
- „Wybierz plan” → `/manage/upgrade`: heading „Rozwiń swój plan” + subtitle „Wybierz
  plan odpowiedni dla Twoich potrzeb”, one card per plan from
  `/api/v1/subscription-plans?for=manager` (StudiQ Launch / Team / Hub / Campus), each
  with its price, feature list and a CTA. Nothing is clicked there: the CTAs start a
  simulated checkout.
- „Konto” → `/manage/account`: heading „Konto”, cards „Zdjęcie profilowe”, „Nazwa”
  (`#name` prefilled with the account name, read-only e-mail field, role badge with the
  **org** role — `admin` for the seeded manager, „Użytkownik od” date) and „Zmień hasło”
  (`#currentPassword`, `#newPassword`, `#confirmPassword`, button „Zaktualizuj hasło”,
  disabled while the fields are empty). This is the screen the case reports missing.
- „Płatności” → `/manage/billing`: heading „Rozliczenia”, card „Aktualny plan” with the
  „Plan uczelniany” description, the current plan name as a badge (`/api/v1/me/plan`
  resolves the active organization's plan) and the „Kontakt z handlowcem” mailto link —
  the only action of the simulated billing module.
- Comparison path (last bullet of the case): the same menu routes by account type. The
  teacher's „Konto” goes to `/edu/account`, the student's to `/app/account`.
- Environment caveat: the shared app answered `/edu/upgrade` with a redirect to
  `/checkout?plan_id=teacher_license` — the pre-#631 behaviour, i.e. the running build
  predates that fix even though `qa-suite` contains it. The teacher/student leg of this
  case therefore only covers the account screen (the student's `/app/upgrade` renders
  normally, but a per-role asymmetry is not worth encoding).
