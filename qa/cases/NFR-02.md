# NFR-02 — Zmiana języka (PL ⇄ EN)

- id: NFR-02
- priority: P1 krytyczny
- module: NFR – Wymagania niefunkcjonalne i międzyobszarowe
- section: Język i motyw
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany użytkownik.

## Steps

1. W menu użytkownika wybierz „English”, potem „Polski”.
2. Powtórz na stronach publicznych (jeśli dostępny przełącznik) i w panelu admina.

## Expected result

- Po zmianie strona przeładowuje się w wybranym języku (ciasteczko NEXT_LOCALE, ważne rok); przy zaznaczonym aktualnym języku widoczny ✓.
- Wersja angielska nie zawiera polskich fragmentów, a polska – angielskich; liczebniki (fiszka/fiszki/fiszek) odmieniają się poprawnie.
- Język jest zapamiętany po ponownym logowaniu.

## QA tenant fixture (reconciled)

The case was written against the legacy manual seed (`student1@dev.local`, password `pass`).
The suite version uses the case's own tenant and never the legacy accounts.

- Profile: `content` (`qa/tests/profiles/NFR-02.json`) — one organization, the default group
  `G1`, and one account per account type: `manager`, `teacher`, `student`.
- Seed: `bun scripts/qa-tenant.ts NFR-02 --fresh` — a fresh run suffix per independent run, so
  every run gets its own org/group/users from
  `tenantKey('qa/cases/NFR-02.md', 'NFR-02#<suffix>', 'qa-shared')` + `tenantId(key, entity)`.
  The spec reads the ids and credentials through `loadTenant('NFR-02')`.
- The signed-in user is the tenant's `student` (the case's prerequisite is only „logged in”;
  the student panel is the smallest surface that shows the user menu, plural counters and the
  login form after a logout).
- Content (created by the spec through the product API, idempotently): three personal decks
  with exactly 1, 2 and 5 flashcards, owned by the student — the plural check
  („fiszka/fiszki/fiszek”). Each run deletes and recreates only its own three decks, so a
  reused tenant never accumulates cards and the student's Base limits stay untouched.
- Public leg (step 2): the landing page footer toggle needs no session and no tenant rows; the
  spec visits it in a fresh browser context (no `NEXT_LOCALE` cookie), so the default `pl`
  render is deterministic.
- Admin panel leg (step 2): **N/A** — `apps/admin` has no language switcher (its i18n only
  reads `NEXT_LOCALE`); the shared suite app is `:3010`, the admin panel is a separate `:4010`
  app. There is nothing to repeat there.
- Not used: global admin settings, feature flags, plan rows/catalogues, platform stats,
  singleton rows or another tenant.

## Walk observations (shared app, pl ⇄ en)

- User menu (sidebar, bottom): „Polski” / „English” each carry a globe icon; the active one
  shows a `lucide-check` ✓ on the right. Choosing a language writes
  `NEXT_LOCALE=<lang>; path=/; max-age=31536000` (365 days) and calls
  `window.location.reload()` — `performance.navigation.type` is `reload` afterwards.
- After the reload the whole dashboard chrome switches: sidebar groups
  („Główne / Nauka / Treści / Statystyki” ↔ „Main / Study / Content / Statistics”), links
  („Przegląd, Fiszki, Tematy, Pytania…” ↔ „Overview, Flashcards, Topics, Questions…”),
  breadcrumb („Moja Nauka” ↔ „My Learning”), h1 greeting („Cześć,” ↔ „Hello,”) and every
  user-menu item („Wybierz plan, Konto, Płatności, Motyw, Wyloguj się” ↔
  „Upgrade, Account, Billing, Theme, Logout”).
- Public landing page: the footer „Language” button switches the hero
  („Tylko to, co musisz umieć.” ↔ „Learn Smarter, Not Harder”) and footer links
  („Funkcje / Cennik / Kontakt / Polityka Prywatności / Regulamin” ↔
  „Features / Pricing / Contact / Privacy Policy / Terms of Service”). This toggle uses
  `router.refresh()`, so the URL stays `/` and the document is not reloaded; the active
  language is marked in bold instead of ✓ (the ✓ is the user-menu indicator).
- Plurals on `/app/flashcards`: 1 → „1 fiszka” / „1 flashcard”, 2 → „2 fiszki” /
  „2 flashcards”, 5 → „5 fiszek” / „5 flashcards”. Correct in both directions.
- Persistence: the cookie survives logout (`POST /api/v1/auth/logout` does not clear it), so
  `/login` renders in the chosen language and a fresh form sign-in lands on the dashboard in
  that same language; a reload keeps it.
- Language names „Polski”/„English” are intentionally shown in their own language in both
  locales; they are not treated as foreign fragments.
- Observation for triage (not asserted): the org switcher prints the org role **display name**
  straight from the database, and the seeded default is English („Member”, „Admin”,
  „Teacher”), so the Polish page shows „Member” under the org name. That is tenant data, not
  locale copy — a manager can rename roles. Likewise `packages/ui` keeps a few hardcoded
  English accessibility strings (`aria-label`/`sr-only` „Toggle Sidebar”, the command-palette
  „Command Palette” / „Search for a command to run…”), which are not part of the localized
  copy surface this case checks. Both are pre-existing i18n gaps outside NFR-02's steps; they
  should be triaged separately rather than encoded as expectations here.
