# STU-42 — Statystyki – „Treści” (/app/stats/content)

- id: STU-42
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Statystyki studenta
- prereqs: STU-05
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Konto z historią nauki (po STU-05).

## Prerequisite — tenant model (reconciled with the suite seeder)

The legacy manual seed (`student1@dev.local`, password `pass`, `O1G1`,
`fiszki_poprawne.csv`) is not used. The case runs on its own tenant, seeded before
every independent run:

```bash
bun scripts/qa-tenant.ts STU-42 --fresh
```

- Profile: `content` (`qa/tests/profiles/STU-42.json`) — one organization, an
  unused manager/org admin, an educator, and the `student` account the case logs in
  as, plus the default group `G1`.
- Tenant key: `tenantKey('qa/cases/STU-42.md', 'STU-42#<run>', 'qa-shared')`; every
  org/user/group/deck/card id derives from it via `tenantId`.
- Study history: the spec builds it itself (the profile seeds the graph only) — a
  `STU-42 <run>` deck with four cards and the practice rows a study session writes:
  Alfa 5 attempts / 4 correct, Bravo 2 / 1, Charlie 3 / 3, Echo never practiced.
  That covers the STU-05 prerequisite (a student with learning history) without
  depending on another case's data: „Wszystkie fiszki” 4, „Przećwiczone” 3,
  „Śr. poprawność” 77 %, „Śr. łatwość” 2.03, „Nowe fiszki” 1.
- Re-runs on a CI-seeded tenant delete their own `STU-42 …` decks first (cascading
  cards, practice rows and review state) and rebuild the fixture, so a retry never
  sees a previous pass's rows.

Spec: `qa/tests/STU/STU-42.spec.ts` (Playwright, `qa/tests/STU/`).

## Prerequisite context

### STU-05 — Sesja nauki – ocena fiszek (ścieżka pełna)

_Warunek wstępny: Przygotuj talię z kilkoma fiszkami (import CSV – plik fiszki_poprawne.csv z folderu Studiq_dane_testowe, 8 fiszek). Zalogowany student._

1. Na „Ucz się” kliknij „Rozpocznij naukę” / „Rozpocznij Przegląd”.
2. Dla pierwszej fiszki kliknij kartę, aby odsłonić odpowiedź.
3. Oceń kolejno fiszki przyciskami „Nie pamiętam”, „Trudne”, „Dobrze”, „Łatwe” (po jednej każdą).
4. Doprowadź sesję do końca.

Expected:

- Widoczne: licznik postępu, plakietka stanu fiszki (Nowa / Nauka / Przegląd / Poprawka), „Kliknij, aby odkryć odpowiedź”.
- Po odkryciu pojawiają się 4 przyciski ocen; każda ocena przechodzi do kolejnej fiszki.
- W trybie nauki (learning) etykiety przycisków: „Nie pamiętam (reset)”, „Trudne (zostań)”, „Dobrze (dalej)”, „Łatwe (zakończ)”.
- Na końcu ekran „Sesja zakończona!” z podsumowaniem: poprawne, czas, fiszek/min (w każdym trybie).
- Tryb „Limitowany” po osiągnięciu celu: przyciski „Przeglądaj ponownie” i „Powrót do przeglądu”.
- Tryb „Bez limitu” po wyczerpaniu kolejki: blok „Wszystko powtórzone!” z wyjaśnieniem „W tej sesji powtórzyłeś wszystkie fiszki z kolejki.”, tylko przycisk „Powrót do przeglądu” (kolejka nie jest uruchamiana ponownie).

## Steps

1. Otwórz /app/stats (przekierowanie) i przejrzyj zakładkę „Treści”.
2. Sortuj tabelę fiszek po: Data dodania, Próby, Poprawność, Łatwość.

## Expected result

- /app/stats przekierowuje do /app/stats/content.
- Karty: Wszystkie fiszki, Przećwiczone, Śr. poprawność, Śr. łatwość; podział na stany (Nowa, W nauce, Powtórka, Poprawa, Oporne).
- Tabela: Stan, Przód, Próby, Poprawność, EF, Interwał; wiersz rozwija szczegóły (Pytanie/Odpowiedź/Powtórzenia/Krok nauki/Pomyłki/Ostatnia powtórka).
- Sekcje „Najsłabsze talie” i „Najsłabsze tematy” (lub komunikaty „ćwicz dalej!”).

## As-built notes (walked on the shared app, 2026-10-29)

The stats module is three sibling sidebar pages, not tabs of one page:
„Treści” (`/app/stats/content`, this case), „Wyniki” (`/app/stats/results`,
STU-43) and „Aktywność” (`/app/stats/activity`, STU-44). Confirmed on the shared
app:

- `/app/stats` → `/app/stats/content`, heading „Treści”, „Treści” marked active in
  the sidebar.
- Cards: „Wszystkie fiszki”, „Przećwiczone”, „Śr. poprawność”, „Śr. łatwość” and
  the page's own „Nowe fiszki” (never practiced). „Śr. poprawność” is the mean of
  the per-card accuracy, „Śr. łatwość” the mean easiness factor of the practiced
  cards.
- The state vocabulary is this page's filter row („Wszystkie”, „Nowe”,
  „Do nauczenia”, „Do utrwalenia”, „Do przypomnienia”, „Oporne”) and the state
  badge of each table row („Nowa”, „W nauce”, „Powtórka”, „Poprawa”, „Oporne”);
  filtering narrows the table by state.
- Table columns „Stan / Przód / Próby / Poprawność / EF / Interwał”; a row expands
  into „Pytanie / Odpowiedź / Powtórzenia / Krok nauki / Pomyłki /
  Ostatnia powtórka” (plus the next-review line).
- „Data dodania”, „Próby”, „Poprawność” and „Łatwość” re-sort the table
  descending; the sort menu has no ascending option.
- The „podział stanów” chart and the „Najsłabsze talie” / „Najsłabsze tematy”
  sections of the Expected block are **not** on this page: they are the
  „Aktywność” page (`/app/stats/activity`) and are covered by STU-44. The spec for
  STU-42 asserts the content page plus the presence/active state of the three
  stats entries, and asserts the state vocabulary through this page's filters and
  badges.
