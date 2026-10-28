# SEC-02 — Student z innej organizacji

- id: SEC-02
- priority: P1 krytyczny
- module: SEC – Autoryzacja i izolacja danych
- section: Izolacja między organizacjami i grupami
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

student2 (UE Wrocław).

## Seed (tenant model)

Automatyzacja nie używa kont z ręcznego seeda (`student2@dev.local`, `pass`, UE Wrocław).
Przypadek dostaje własny tenant z **dwoma** organizacjami, żeby „student z innej
organizacji” był prawdziwym outsiderem, a nie członkiem obu organizacji:

```bash
bunx playwright test -c qa/playwright.qa.config.ts \
  qa/tests/SEC/SEC-02.spec.ts --workers=1
```

Spec seeduje wszystko sam przez `seedTenantGraph()` (`__tests__/helpers/tenant-seed.ts`),
więc nie wymaga wcześniejszego uruchomienia `scripts/qa-tenant.ts`.

- Klucz tenanta: `SEC-02.md::SEC-02 cross-organization deck and organization isolation::qa-shared::<run>`
  — `tenantKey('qa/cases/SEC-02.md', <tytuł>, 'qa-shared')` + `tenantId`, ten sam schemat co
  fixture'y e2e, z sufiksem `::org-a` / `::org-b` na organizację (wspólny `org_members.id`
  by się inaczej nadpisał). Domyślnie każdy przebieg dostaje świeży sufiks, więc ma własną
  parę organizacji; `QA_RUN_SUFFIX` utrwala przebieg.
- Organizacja A `qa-sec02-a-<run>`: nauczyciel A (admin) i student A (członek grupy
  `O1G1-<run>`). Nauczyciel A tworzy przez API talię grupową `O1G1T1 <run>` z jedną fiszką
  (`front-secret-a-<run>` / `back-secret-a-<run>`) i udostępnia ją grupie — odpowiednik
  talii O1G1T1 z opisu przypadku.
- Organizacja B `qa-sec02-b-<run>`: nauczyciel B (admin) i student B (członek grupy
  `O2G1-<run>`). **Student B jest outsiderem**: należy tylko do B, nigdy do A. Nauczyciel B
  tworzy własną talię `O2G1T1 <run>` jako kontrolę pozytywną.
- Hasła: `Seed4Test!` (z `tenant-seed.ts`); konta `seed-student-<hash>@dev.local` /
  `seed-educator-<hash>@dev.local`.
- Spec: `qa/tests/SEC/SEC-02.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl` (kopie interfejsu w przypadku są polskie).
- Izolacja: test tworzy wyłącznie własne organizacje/użytkowników/talie i czyta tylko ich
  dane. Nie dotyka innego tenanta, ustawień admina, flag funkcji, planów, statystyk
  platformy ani wierszy singletonowych.

## Steps

1. Spróbuj otworzyć talię O1G1T1 (00000000-0000-4000-8006-000000000001).
2. Zapytaj API o członków własnej organizacji i o organizację O1: fetch('/api/v1/organization/00000000-0000-4000-8000-000000000001').

## Expected result

- Brak dostępu do talii i danych organizacji WSB Merito (404/403).

## Observations (walk 2026-10-28, shared app :3010, worker qa-env-8)

- Student B (organizacja B) otwiera `/app/flashcards/<talia A>`: strona pokazuje
  „Nie znaleziono talii” i „Ta talia mogła zostać usunięta lub nie masz do niej dostępu.”;
  nazwa talii ani treść fiszki nie są renderowane. Stan „nie znaleziono” dotyczy całej
  strony talii (bez 404 na poziomie trasy).
- `GET /api/v1/flashcards/decks/<talia A>` → 404 `{"success":false,"error":"NOT_FOUND"}`,
  bez danych talii. `GET /api/v1/flashcards?deckIds=<talia A>` → 200 z pustą listą
  `items`, `GET /api/v1/flashcards/<fiszka A>` → 404.
- `PUT /api/v1/flashcards/decks/<talia A>` (zmiana nazwy) → 404; talia pozostaje
  niezmieniona — jej właściciel nadal widzi tę samą nazwę i 1 fiszkę.
- `GET /api/v1/organization/<organizacja A>` → 403 `{"success":false,"error":"FORBIDDEN"}`,
  bez danych organizacji. `/api/v1/organization/members` jako student → 403 (trasa jest
  zastrzeżona dla edukatora/managera), więc lista członków organizacji A nie wycieka.
- Lista talii studenta B (`/app/flashcards` i `GET /api/v1/flashcards/decks`) zawiera tylko
  talię jego organizacji (`O2G1T1`, badge grupy `O2G1`), bez talii organizacji A.
- Kontrole pozytywne: student A (ta sama organizacja, członek grupy O1G1) otwiera talię
  `O1G1T1` i widzi jej nazwę oraz fiszkę (200 z API); student B otwiera własną talię
  `O2G1T1`; nauczyciel B czyta własną organizację (200) i własną talię (200), a
  organizację A (403) i talię A (404).
- Strona talii renderuje front fiszki dwa razy w DOM (jedna kopia jest ukryta — układ
  mobilny), więc asercje widoczności filtrują do widocznych elementów.
