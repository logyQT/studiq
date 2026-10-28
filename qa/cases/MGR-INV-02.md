# MGR-INV-02 — Zaproszenia zbiorcze (wiele wierszy)

- id: MGR-INV-02
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Zaproszenia (/manage/invites)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

M1.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`manager@dev.local`, `pass`). Przypadek
potrzebuje managera organizacji wraz z jej rolami systemowymi — czyli profilu `content`:

```bash
bun scripts/qa-tenant.ts MGR-INV-02 --fresh
```

- Klucz tenanta: `MGR-INV-02.md::MGR-INV-02#<run>::qa-shared` —
  `tenantKey('qa/cases/MGR-INV-02.md', 'MGR-INV-02#<run>', 'qa-shared')` + `tenantId`,
  ten sam schemat co fixture'y e2e. `--fresh` nadaje nowy sufiks przebiegu, a adresy
  zapraszanych osób są z niego wyprowadzane: każdy niezależny przebieg ma własny,
  unikalny zestaw e-maili i nie koliduje z zaproszeniami z poprzedniego przebiegu.
- Organizacja `qa-mgr-inv-02-<run>` z rolami systemowymi `admin` / `teacher` / `member`
  (w interfejsie: Admin / Student / Teacher) oraz konto managera
  `seed-manager-<hash>@dev.local` / `Seed4Test!` z rolą `admin`.
- Worker QA-suite seeduje **wspólną** bazę (`http://localhost:54421`);
  `scripts/qa-tenant.ts` bierze URL z `qa/env.json`, a klucz service role z
  `apps/web/.env`.
- Spec: `qa/tests/MGR/MGR-INV-02.spec.ts`, projekt `qa/playwright.qa.config.ts`,
  baseURL `http://localhost:3010`, `NEXT_LOCALE=pl` (kopie interfejsu w przypadku są
  polskie).
- Izolacja: test czyta role wyłącznie z aktywnej organizacji tenanta i wysyła
  zaproszenia tylko do niej. Nie dotyka innego tenanta, flag funkcji, planów ani
  wierszy singletonowych.

## Steps

1. Dodaj 3 wiersze przyciskiem „Dodaj kolejną”, wpisz różne e-maile i role (jeden wiersz usuń ikoną X).
2. Wyślij.

## Expected result

- Pole usunięcia wiersza dostępne tylko przy > 1 wierszu; wyniki dla każdego e-maila z osobnym statusem.
- Wiersze bez e-maila/roli są pomijane; gdy nie ma żadnych poprawnych – toast „Dodaj przynajmniej jeden e-mail z rolą.”.

## Observed during the suite walk (qa-env-4, shared app :3010 / DB :54421)

- `/manage/invites` startuje z jednym pustym wierszem i **bez** przycisku X; X pojawia się
  dopiero przy dwóch wierszach (wtedy oba go mają). Nazwa dostępna przycisku to
  `Usuń wiersz {n}` i numeruje się od nowa po usunięciu wiersza. „Dodaj kolejną” dodaje
  pusty wiersz bez wstępnie wybranej roli (placeholder „Rola”); opcje to nazwy wyświetlane
  Admin / Student / Teacher.
- Trzy wiersze z różnymi e-mailami i rolami, usunięcie środkowego X-em, wysłanie dwóch
  pozostałych: `POST /api/v1/organization/invites/bulk` → `200` z dwoma wynikami. Karta
  „Wyniki” pokazuje jeden wpis na e-mail, każdy z własnym statusem „Sukces”, kodem
  zaproszenia i linkiem; tabela „Wysłane zaproszenia” pokazuje oba adresy z właściwą rolą
  i statusem „Oczekujące”; formularz wraca do jednego pustego wiersza.
- Wiersz **całkowicie pusty** jest pomijany: nie trafia do żądania, nie tworzy wyniku i nie
  blokuje wysyłki. Formularz z samymi pustymi wierszami jest odrzucany toastem
  „Dodaj przynajmniej jeden e-mail z rolą.” i nie wysyła żadnego żądania.
- Wiersz **częściowo** wypełniony nie jest pomijany — to decyzja produktowa z 2026-10-20
  (issue #244, ten sam przypadek): e-mail bez roli daje „Wiersz {n}: wybierz rolę.”, rola
  bez e-maila daje „Wiersz {n}: wpisz adres e-mail.”, a „Wyślij zaproszenia” jest
  zablokowany. Zdanie przypadku „wiersze bez e-maila/roli są pomijane” dotyczy więc
  wierszy całkowicie pustych; półwypełniony wiersz jest nazwany, a nie po cichu odrzucony.
- Uwaga językowa (P3, poza kryteriami przypadku): toast po wysyłce ma sztywną formę
  „Wysłano {count} zaproszeń.”, np. „Wysłano 2 zaproszeń.” zamiast „2 zaproszenia”.
