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

Kryterium jest **kontrakt strony**, nie jej brzmienie. Zdania marketingowe żyją w
`apps/web/src/i18n/messages/pl.json`; powtarzanie ich tutaj przypina tekst zamiast
zachowania i czerwienieje przy każdej zmianie copy, choć strona działa.

- Strona ładuje się bez błędów (konsola przeglądarki bez czerwonych błędów).
- `lang="pl"` na `<html>`.
- Widoczne sekcje o stabilnych identyfikatorach: `#hero`, `#features`, `#how-it-works`,
  `#pricing`, `#get-started`.
- Dokładnie jeden `<h1>`, należący do `#hero`; każda sekcja ma nagłówek; żadna sekcja nie
  renderuje się pusta.
- Hero oferuje dwie akcje: rejestrację (`/register`) i przegląd funkcji (`/features`).
- Nagłówek: `/features`, `/pricing`, `/login`, `/register`. Stopka: `/features`, `/pricing`,
  `/contact`, `/privacy`, `/terms`. Baner `#get-started` prowadzi do `/register`.
- Każdy przycisk CTA ma dostępną nazwę (nie jest samą ikoną).
- Brak surowych kluczy tłumaczeń (`LandingPage.*`, `PricingPage.*`, `Navbar.*`, `Footer.*`)
  ani tekstów „undefined”/„NaN”.
- Strona nie zawiera wymyślonych liczb ani opinii. Reguła i uzasadnienie:
  [PRODUCT.md](../../PRODUCT.md) → Status.

## Odstępstwo od dokumentu

Dokument testera wymienia jako widoczne: sekcję statystyk („Utworzonych pytań / Fiszek /
Aktywnych uczniów / Rozwiązywanych testów”) oraz opinie („Pokochane przez studentów i
nauczycieli”, cytaty „Maria K.” i „Dr. Tomasz N.”). Oba bloki usunięto, bo produkt nie był
na rynku, a liczby i osoby były zmyślone. Kryterium akceptacji nie obejmuje więc ich
obecności, a obecność fikcyjnych danych jest usterką, nie cechą.

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
