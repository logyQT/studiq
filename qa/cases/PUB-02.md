# PUB-02 — Strona „Funkcje” (/features)

- priority: P2 ważny
- module: PUB – Strony publiczne i nawigacja ogólna
- section: Funkcje, Cennik, Kontakt, strony prawne

## Prerequisite (verbatim)

Brak sesji.

## Seed (QA-suite tenant)

The page is public: the acceptance criteria are the anonymous visitor's, so the spec signs
nobody in and sends no storage state. The case uses the default `content` tenant (no
`__tests__/qa/profiles/PUB-02.json`); nothing on the page reads a tenant, plan, flag or
singleton row.

- tenant key: `tenantKey("qa/cases/PUB-02.md", "PUB-02", "qa-shared")` →
  `PUB-02.md::PUB-02::qa-shared`; seed with `bun run env:run -- bun scripts/qa-tenant.ts PUB-02`
- the tenant users are deliberately unused

## Steps

1. Otwórz /features (QA: adres aplikacji z `QA_APP_URL`).
2. Przejrzyj cztery obszary: Pętla nauki, Z materiałów do ćwiczeń, Nauczanie i grupy, Organizacja.
3. Obejrzyj przykład produktu przy obszarach 01–03.
4. Sprawdź spis obszarów w nagłówku strony.
5. Sprawdź działania: „Zacznij naukę za darmo”, „Zobacz cennik”, „Porozmawiajmy o wdrożeniu”.

## Expected result

- Strona ma dokładnie jeden nagłówek `h1`; poziomy nagłówków rosną o jeden (bez przeskoków).
  Nagłówki funkcji są nagłówkami `h3`, nie `div`-ami.
- Cztery sekcje z identyfikatorami `#study-loop`, `#material`, `#teaching`, `#organization`.
  Każda ma jeden `h2` i co najmniej dwie funkcje jako `h3`.
- Spis obszarów w nagłówku strony prowadzi do tych czterech sekcji (cztery odnośniki `#…`).
- Obszary 01–03 kończą się przykładem z produktu; obszar 04 kończy się odnośnikiem do
  `/contact`. „Wynik: 75%” ani żadna karta wyniku nie występuje na stronie.
- Jedyna tabela na stronie to pule miejsc w obszarze Organizacja (plan, wykupione,
  przydzielone, dostępne). Porównanie planów i limity są wyłącznie na `/pricing`;
  nie ma nazw planów „Darmowy / Premium / Uniwersytecki”. Obszar 04 kończy się tą
  tabelą oraz odnośnikiem do `/contact`.
- Trzy różne miejsca docelowe: `/register` (działanie główne, wysokość ≥ 44 px),
  `/pricing`, `/contact`. Żaden odnośnik nie prowadzi do zalogowanej aplikacji
  (`/app`, `/edu`, `/manage`).
- Brak surowych kluczy tłumaczeń, „undefined” i „NaN” w treści; brak błędów konsoli.
