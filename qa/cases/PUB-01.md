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
- the tenant users are deliberately unused; nothing in the case reads or mutates tenant,
  plan, feature-flag or singleton data (the pricing teaser is DB-driven, so it is asserted
  by section and "Zobacz Pełny Cennik" link only — never by plan names or prices)

## Steps

1. Otwórz http://localhost:3000/ (QA: http://localhost:3010/).
2. Przewiń stronę od góry do stopki.

## Expected result

Kryterium jest **kontrakt strony**, nie jej brzmienie: zdania marketingowe żyją w
`apps/web/src/i18n/messages/pl.json`, a powtarzanie ich w teście przypina tekst zamiast
zachowania (czerwony test przy każdej zmianie copy, przy sprawnej stronie).

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
- Brak surowych kluczy tłumaczeń (np. LandingPage.xxx) ani tekstów „undefined”/„NaN”.

## Zakaz fikcyjnego dowodu

Strona nie może zawierać wymyślonych liczb ani opinii. Do 2026-11-14 sekcja statystyk
podawała `10,000+` pytań, `50,000+` fiszek, `5,000+` uczniów i `100,000+` testów jako
wartości zaszyte w komponencie, a sekcja opinii cytowała „Maria K.” i „Dr. Tomasz N.”.
Produkt nie był wtedy na rynku, więc oba bloki zostały usunięte wraz z kluczami i18n.
Dowód społeczny wraca dopiero z prawdziwymi danymi (liczba kont, opinia za zgodą autora);
do tego czasu strona mówi tylko to, co można sprawdzić.

## Observations (walk, 2026-10-28, shared app :3010, QA worker qa-env-1)

Ustalenia z tego przejścia, które pozostają aktualne po usunięciu fikcyjnego dowodu:

- Brak błędów konsoli, surowych kluczy, „undefined”/„NaN”.
- Kolejność sekcji: hero → „Co Otrzymujesz Za Darmo” + „Wspomagaj Naukę z AI” →
  „Jak to działa” → „Prosty, Przejrzysty Cennik” → baner → stopka. Przypadek testera
  wymienia „Jak to działa” przed blokiem darmowym — różni się tylko kolejność listy
  w dokumencie, nie treść, więc test sprawdza obecność sekcji, nie ich kolejność.
- Nagłówek: Funkcje `/features`, Cennik `/pricing`, Logowanie `/login`, Rejestracja
  `/register`; hero: `/register` i `/features`; baner: `/register`; stopka: Funkcje/Cennik/
  Kontakt/Prywatność/Regulamin → `/features`, `/pricing`, `/contact`, `/privacy`, `/terms`.
- Kafelki cennika pochodzą z globalnego katalogu planów (dlatego test nie sprawdza nazw
  ani cen planów).
- Przejście z 2026-10-28 zapisało statystyki jako „statyczne wartości (10,000+ …), nie dane
  z bazy” i potraktowało to jako stan neutralny. To był fikcyjny dowód, nie cecha —
  patrz sekcja wyżej.
