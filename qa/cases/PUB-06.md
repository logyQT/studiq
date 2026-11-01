# PUB-06 — Polityka prywatności i Regulamin

- id: PUB-06
- priority: P3 kosmetyczny
- module: PUB – Strony publiczne i nawigacja ogólna
- section: Funkcje, Cennik, Kontakt, strony prawne
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Otwórz /privacy, a następnie /terms.
2. Przełącz język na angielski (zob. NFR-02) i odśwież obie strony.

## Expected result

- Obie strony zawierają wszystkie sekcje (Administrator Danych … Kontakt; Postanowienia Ogólne … Kontakt).
- Treść jest czytelna; zanotuj błędy językowe (np. w Regulaminie wyraz w obcym alfabecie w sekcji „Płatności i Subskrypcje” – „сохраняется”).
- Po zmianie języka odpowiadająca wersja się ładuje (lub zanotuj brak tłumaczenia).

## Suite seed — tenant model (reconciled)

The case was generated against the legacy manual seed, but its prerequisite is
"no session": both pages are public legal copy whose only input is the
`NEXT_LOCALE` cookie. The suite version therefore needs no tenant user, content id
or organisation — only the shared app and a fresh browser context (empty cookie
jar).

- Case tenant (deterministic, bookkeeping only):
  `tenantKey('qa/cases/PUB-06.md', 'PUB-06', 'qa-shared')` → `PUB-06.md::PUB-06::qa-shared`
- Seed: `bun scripts/qa-tenant.ts PUB-06` against the shared Supabase (org
  `qa-pub-06-shared`, manager/teacher/student, password `Seed4Test!`). The spec
  asserts none of those rows; the tenant exists so the case has a deterministic,
  isolated identity like every other suite test.
- Spec: `__tests__/qa/PUB/PUB-06.spec.ts`, project `qa/playwright.qa.config.ts`,
  baseURL `http://localhost:3010`.
- Isolation: each test starts with an empty cookie jar, so `NEXT_LOCALE` falls
  back to the `pl` default and the test never reads or writes another tenant's
  data. Nothing shared or singleton is mutated.

## Observed during the suite walk (qa-env-6, shared app 3010 / DB 54421)

- `/privacy` renders 8 sections in Polish by default: Administrator Danych,
  Jakie Dane Zbieramy, Cel Przetwarzania, Podstawa Prawna, Twoje Prawa,
  Przechowywanie Danych, Pliki Cookies, Kontakt. Title: „Polityka Prywatności |
  StudiQ”, `<html lang="pl">`.
- `/terms` renders 9 sections: Postanowienia Ogólne, Konta Użytkowników, Usługi,
  Treści Użytkowników, Płatności i Subskrypcje, Ograniczenie Odpowiedzialności,
  Pliki Cookies, Zmiany Regulaminu, Kontakt. Title: „Regulamin | StudiQ”.
- Both pages are reachable without a session from the public footer links
  („Polityka Prywatności”, „Regulamin”) and carry readable body copy (the
  `TermsPage` cookies section also renders its three list items).
- The language toggle lives in the footer (button `title="Language"`, menu items
  „🇵🇱 Polski” / „🇬🇧 English”). Choosing English switches `/terms` in place to
  „Terms of Service” and `/privacy` to „Privacy Policy”, sets `NEXT_LOCALE=en`
  and `<html lang="en">`; both pages keep the English version after a reload.
  Switching back to „Polski” restores „Regulamin” and survives a reload.
- The Cyrillic word „сохраняется” reported for „Płatności i Subskrypcje” is **not**
  present on this branch: the Polish section reads „…a dostęp jest zachowany do
  końca okresu rozliczeniowego.”, and the English one is fully translated. No
  foreign-alphabet characters are rendered on either page in either language.
- The footer toggle marks the active language with font weight rather than the ✓
  from NFR-02; that marker belongs to NFR-02 and is not asserted here.
