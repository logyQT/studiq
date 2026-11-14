# PUB-01 — Strona główna – struktura i nawigacja (niezalogowany)

- id: PUB-01
- priority: P1 krytyczny
- module: PUB – Strony publiczne i nawigacja ogólna
- section: Strona główna
- prereqs: none (public route, no session)
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji. Język: polski.

## Seed (tenant model)

The landing page is public: the acceptance criteria are the anonymous visitor's, so the
spec signs nobody in and sends no storage state.

- tenant key: `tenantKey("qa/cases/PUB-01.md", "PUB-01", "qa-shared")`
- seed: `bun scripts/qa-tenant.ts PUB-01` → org `qa-pub-01-shared`, manager/teacher/student
  (`Seed4Test!`), group `G1` (`bun scripts/qa-tenant.ts PUB-01 --reset` before a repeat run)
- the tenant users are deliberately unused; the case asserts and mutates no tenant, plan,
  feature-flag or singleton data (the pricing teaser reads the plan catalogue, but the
  case checks it by section and "Zobacz Pełny Cennik" link only — never by name or price)

## Steps

1. Otwórz http://localhost:3000/ (QA: http://localhost:3010/).
2. Przewiń stronę od góry do stopki.

## Expected result

- Strona ładuje się bez błędów (konsola przeglądarki bez czerwonych błędów).
- Widoczne: plakietka „Platforma edukacyjna oparta na AI”, nagłówek „Tylko to, co musisz umieć.”, podtytuł, przyciski „Zacznij Naukę Za Darmo” i „Zobacz Funkcje”.
- Widoczne sekcje: statystyki (Utworzonych pytań / Fiszek / Aktywnych uczniów / Rozwiązanych testów), „Jak to działa” (3 kroki), „Co Otrzymujesz Za Darmo”, „Wspomagaj Naukę z AI”, „Prosty, Przejrzysty Cennik”, opinie („Pokochane przez studentów i nauczycieli”), baner „Gotowy na transformację nauki?”, stopka.
- Brak surowych kluczy tłumaczeń (np. LandingPage.xxx) ani tekstów „undefined”/„NaN”.

## Suite checks — anchored to this criterion (English, suite-owned)

The criterion above is the page's **contract**, not its wording. The marketing sentences live
in `apps/web/src/i18n/messages/pl.json`, so the suite asserts the structure the copy sits in
and the destinations it points at. Repeating a sentence here would pin the draft instead of
the behaviour, and would go red on every copy edit while the page still works.

- The page loads with no errors (no red browser-console entries).
- `lang="pl"` on `<html>`.
- Sections with stable ids are visible: `#hero`, `#features`, `#how-it-works`, `#pricing`,
  `#get-started`.
- Exactly one `<h1>`, belonging to `#hero`; every section carries a heading; no section
  renders empty.
- The hero offers two actions: register (`/register`) and see the features (`/features`).
- Header: `/features`, `/pricing`, `/login`, `/register`. Footer: `/features`, `/pricing`,
  `/contact`, `/privacy`, `/terms`. The `#get-started` band leads to `/register`.
- Every CTA button has an accessible name (it is never an icon alone).
- No raw translation keys (`LandingPage.*`, `PricingPage.*`, `Navbar.*`, `Footer.*`) and no
  `undefined`/`NaN` strings.
- The page carries no invented numbers or testimonials. Rule and rationale:
  [PRODUCT.md](../../PRODUCT.md) → Status.

### Two intentional omissions from the source document

The tester document lists a statistics section („Utworzonych pytań / Fiszek / Aktywnych
uczniów / Rozwiązywanych testów”) and a testimonials block („Pokochane przez studentów i
nauczycieli”, quotes from „Maria K.” and „Dr. Tomasz N.”). Both blocks were removed because
the product was not on the market and the numbers and the people were invented. The
acceptance criterion therefore does not cover their presence, and fabricated data on the page
would be a defect rather than a feature.

## Observations (walk, 2026-10-28, shared app :3010, QA worker qa-env-1)

Poniżej wyłącznie to, czego wymagania nie mówią: kolejność, źródło danych i zachowania
brzegowe.

- Kolejność sekcji: hero → „Co Otrzymujesz Za Darmo” + „Wspomagaj Naukę z AI” →
  „Jak to działa” → „Prosty, Przejrzysty Cennik” → baner → stopka. Dokument testera
  wymienia „Jak to działa” przed blokiem darmowym; to różnica w kolejności listy, nie w
  treści, więc przypadek sprawdza obecność sekcji, nie kolejność.
- Kafelki cennika pochodzą z globalnego katalogu planów (`/api/v1/subscription-plans`),
  dlatego test nie sprawdza nazw ani cen planów: zmieniają się w danych, nie w kodzie.
- Kafelki mają trzy poziomy: plan darmowy, plan płatny i kafelek instytucjonalny, którego
  cena jest ceną „od” najtańszego planu menedżerskiego (`pickLandingPlans`).
