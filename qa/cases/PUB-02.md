# PUB-02 — Strona „Funkcje” (/features)

- id: PUB-02
- priority: P2 ważny
- module: PUB – Strony publiczne i nawigacja ogólna
- section: Funkcje, Cennik, Kontakt, strony prawne
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Seed (tenant model)

The page is public: the acceptance criteria are the anonymous visitor's, so the spec
signs nobody in and sends no storage state.

- tenant key: `tenantKey("qa/cases/PUB-02.md", "PUB-02", "qa-shared")` →
  `PUB-02.md::PUB-02::qa-shared` (`--fresh` runs get
  `PUB-02.md::PUB-02#<suffix>::qa-shared`)
- seed: `bun scripts/qa-tenant.ts PUB-02` → org `qa-pub-02-<key tail>`, manager/teacher/
  student (`Seed4Test!`), group `G1`
- the tenant users are deliberately unused: `/features` is static copy plus a
  plan-comparison table, and the spec reads no tenant, plan, feature-flag or singleton row

## Steps

1. Otwórz /features (QA: http://localhost:3010/features).
2. Przejrzyj listę funkcji i tabelę „Porównanie Planów”.

## Expected result

- Tytuł „Wszystko Czego Potrzebujesz, Aby Odnieść Sukces”.
- Karty funkcji z oznaczeniem planu (Darmowy / Premium / Uniwersytecki), np. „Ręczne Tworzenie Pytań – Darmowy”, „Generowanie Pytań przez AI – Premium”.
- Tabela porównania: kolumny Darmowy / Premium / Uniwersytecki, wartości Tak / Nie / Indywidualny.
- Przycisk „Zacznij Za Darmo” prowadzi do rejestracji.

## Observations (walk, 2026-10-28, shared app :3010, QA worker qa-env-3)

- Wszystkie wymienione napisy są widoczne: tytuł „Wszystko Czego Potrzebujesz, Aby
  Odnieść Sukces”, podtytuł „Od podstawowych fiszek po egzaminy oparte na AI”, 11 kart
  funkcji z ikoną, nazwą i opisem, tabela „Porównanie Planów”, sekcja CTA „Gotowy, Aby
  Zacząć Naukę?”. Brak błędów konsoli, surowych kluczy tłumaczeń, „undefined”/„NaN”.
- Karty: 4 × Darmowy (Ręczne Tworzenie Pytań, Ćwiczenie z Fiszkami, Rozwiązywanie Testów,
  Podstawowe Statystyki), 4 × Premium (Generowanie Pytań przez AI, Generowanie Fiszek
  przez AI, Symulacja Egzaminu AI, Zaawansowana Analityka), 3 × Uniwersytecki
  (Zarządzanie Organizacją, Masowe Zaproszenia, Analityka Uczelni) — kolejność jak w kodzie.
  Oznaczenie planu to plakietka (`Badge`) obok ikony, a nie dopisek w tytule karty.
- Tabela: kolumny dokładnie Funkcja / Darmowy / Premium / Uniwersytecki, 11 wierszy w tej
  samej kolejności co karty. Wartości są graficzne: znacznik „Tak” to ikona `lucide-check`,
  „Nie” to pauza „—”; oba elementy są `aria-hidden` (build współdzielonej aplikacji
  powstał przed #639, więc nie ma jeszcze tekstu `sr-only` „Tak”/„Nie”). Macierz: cztery
  funkcje bazowe — Tak we wszystkich planach; cztery funkcje AI — Tak od Premium;
  trzy funkcje organizacyjne — Tak tylko w Uniwersyteckim.
- Odstępstwo od dokumentu: „Indywidualny” nie występuje na stronie i żaden wiersz nie ma
  wartości „custom” — decyzja produktowa z #291 / PR #639 („the table has no row whose
  value is custom”); klucz `FeaturesPage.comparison_custom` pozostaje nieużywany. Test
  sprawdza więc dwuwartościową macierz Tak/Nie, a nie wartość indywidualną.
- „Zacznij Za Darmo” → `/register`; strona rejestracji pokazuje formularz („Utwórz konto”,
  przycisk „Zarejestruj się”), ale nie ma nagłówka `h1`. Wejście z nagłówka: „Funkcje” →
  `/features`.
