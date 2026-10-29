# PUB-01 — Strona główna – wygląd i treść (niezalogowany)

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
- the tenant users are deliberately unused; nothing in the case reads or mutates tenant,
  plan, feature-flag or singleton data (the pricing teaser is DB-driven, so it is asserted
  by heading and "Zobacz Pełny Cennik" link only — never by plan names or prices)

## Steps

1. Otwórz http://localhost:3000/ (QA: http://localhost:3010/).
2. Przewiń stronę od góry do stopki.

## Expected result

- Strona ładuje się bez błędów (konsola przeglądarki bez czerwonych błędów).
- Widoczne: plakietka „Platforma edukacyjna oparta na AI”, nagłówek „Tylko to, co musisz umieć.”, podtytuł, przyciski „Zacznij Naukę Za Darmo” i „Zobacz Funkcje”.
- Widoczne sekcje: statystyki (Utworzonych pytań / Fiszek / Aktywnych uczniów / Rozwiązanych testów), „Jak to działa” (3 kroki), „Co Otrzymujesz Za Darmo”, „Wspomagaj Naukę z AI”, „Prosty, Przejrzysty Cennik”, opinie („Pokochane przez studentów i nauczycieli”), baner „Gotowy na transformację nauki?”, stopka.
- Brak surowych kluczy tłumaczeń (np. LandingPage.xxx) ani tekstów „undefined”/„NaN”.

## Observations (walk, 2026-10-28, shared app :3010, QA worker qa-env-1)

- Wszystkie wymienione sekcje i napisy są widoczne; brak błędów konsoli, surowych kluczy,
  „undefined”/„NaN”.
- Kolejność na stronie: hero → statystyki → „Co Otrzymujesz Za Darmo” + „Wspomagaj Naukę
  z AI” → „Jak to działa” → opinie → „Prosty, Przejrzysty Cennik” → baner → stopka.
  Przypadek wymienia „Jak to działa” przed blokiem darmowym — różni się tylko kolejność
  listy w dokumencie, nie treść, więc test sprawdza obecność sekcji, nie ich kolejność.
- Nagłówek: Funkcje `/features`, Cennik `/pricing`, Logowanie `/login`, Rejestracja
  `/register`; hero: „Zacznij Naukę Za Darmo” `/register`, „Zobacz Funkcje” `/features`;
  baner: „Zacznij za Darmo” `/register`; stopka: Funkcje/Cennik/Kontakt/Prywatność/
  Regulamin → `/features`, `/pricing`, `/contact`, `/privacy`, `/terms`.
- Statystyki to statyczne wartości (`10,000+`, `50,000+`, `5,000+`, `100,000+`), nie dane
  z bazy; kafelki cennika pochodzą z globalnego katalogu planów (dlatego test nie sprawdza
  nazw ani cen planów).
