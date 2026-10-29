# LIM-02 — Egzekwowanie limitów – w małej skali (obniżone wartości)

- id: LIM-02
- priority: P1 krytyczny
- module: LIM – Funkcje (feature flags) i limity planów
- section: Egzekwowanie limitów
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Konto TS (test-student@dev.local, plan Base, brak treści). Dostęp do Supabase Studio: http://127.0.0.1:54323 → SQL Editor. Na koniec zrób bunx supabase db reset, aby przywrócić limity.

## Steps

1. W SQL Editor wykonaj: update plan_limits set limit_value = 2 where plan_key = 'base' and limit_key in ('max_decks', 'max_flashcards', 'max_questions', 'max_question_banks');
2. Jako TS utwórz 2 talie, następnie spróbuj utworzyć 3. talię.
3. W jednej talii dodaj 2 fiszki, następnie spróbuj dodać 3. (ręcznie).
4. Utwórz 2 banki pytań i spróbuj utworzyć 3. bank.
5. W jednym banku utwórz 2 pytania i spróbuj dodać 3.

## Expected result

- Talie, fiszki i pytania: trzeci element jest odrzucony błędem limitu (USAGE_LIMIT_EXCEEDED / HTTP 429) z czytelnym komunikatem w interfejsie, a nie białym ekranem.
- Banki pytań: z kodu wynika, że limit max_question_banks NIE jest egzekwowany (tylko wyświetlany) – jeśli 3. bank da się utworzyć, zgłoś jako obserwację.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`test-student@dev.local`, `pass`) ani
Supabase Studio. Krok 1 (globalna zmiana `plan_limits` dla planu `base`) **nie jest
odtwarzany**: `plan_limits` to współdzielony katalog planów, z którego liczą się limity
wszystkich tenantów na wspólnej bazie QA — obniżenie go do 2 zepsułoby każdy inny
przypadek (m.in. LIM-03) i wymagałoby resetu bazy. Zamiast tego spec zapełnia **własny
tenant** do rzeczywistego limitu Base i sprawdza odrzucenie `(limit + 1)`-ego elementu —
ta sama ścieżka egzekwowania, tylko w skali planu zamiast sztucznych „2” (identycznie jak
`org-limit` w ONB-10: org jeden etat poniżej limitu zamiast zmiany limitu globalnego).

Tenant: jeden samodzielny student na darmowym planie Base, bez organizacji, bez grup i bez
treści — dokładnie konto „TS” z warunku wstępnego.

```bash
bun scripts/qa-tenant.ts LIM-02 --fresh   # profil: qa/tests/profiles/LIM-02.json
```

- Profil `{"profile":"bare","role":"student"}` — konto wyprowadzone z
  `tenantKey('qa/cases/LIM-02.md', 'LIM-02#<run>', 'qa-shared')` + `tenantId`, bez wiersza
  `org_members`; `personal_plan_key = base` ustawia trigger `handle_new_user`. `--fresh`
  nadaje nowy sufiks przebiegu, więc każdy niezależny przebieg dostaje świeże konto bez
  treści (5 przebiegów = 5 sufiksów).
- Limit Base (`GET /api/v1/me/personal-plan`, wartości z LIM-01): talie 10, fiszki 100,
  pytania 50, banki pytań 5. Spec tworzy treść wyłącznie przez API produktu:
  10 talii (`POST /api/v1/flashcards/decks`), 100 fiszek w jednej talii
  (`POST /api/v1/flashcards/batch/create`), 5 banków (`POST /api/v1/questions/banks`) i 50
  pytań (`POST /api/v1/questions`) — bez organizacji w kontekście obowiązuje plan osobisty
  (#233), więc liczniki dotyczą wyłącznie tego studenta.
- Spec: `qa/tests/LIM/LIM-02.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl`.
- Izolacja: test czyta i zapisuje wyłącznie wiersze swojego tenanta (jego talie, fiszki,
  banki i pytania). Katalog planów (`subscription_plans`, `plan_limits`) jest tylko
  czytany przez publiczne API; żadna flaga funkcji, ustawienie admina, wiersz singletonowy
  ani inny tenant nie są dotykane.
- Powtarzalność (CI: `--retries=2` na tym samym tenancie): setup jest idempotentny —
  dopełnia brakującą liczbę elementów do limitu i pomija te, które już istnieją, więc
  ponowny przebieg na tym samym tenancie nie próbuje tworzyć ponad limit.

## Observed during the suite walk (qa-env-4, shared app 3010 / DB 54421)

- Krok 2 (talie) — przy 10 taliach `POST /api/v1/flashcards/decks` zwraca **429**
  `{"success":false,"error":"USAGE_LIMIT_EXCEEDED"}`. UI: dialog „Utwórz talię” zostaje
  otwarty, lista nadal działa (żadnego białego ekranu), a u góry pojawia się toast
  „Nie udało się zapisać talii” (typ `error`, ~4 s).
- Krok 3 (fiszki) — przy 100 fiszkach `POST /api/v1/flashcards` zwraca **429**
  `USAGE_LIMIT_EXCEEDED`. UI: w dialogu „Utwórz Nową Fiskę” toast „Nie udało się zapisać”,
  dialog pozostaje otwarty, a talia nadal pokazuje 100 fiszek.
- Krok 4 (banki) — przy 5 bankach `POST /api/v1/questions/banks` zwraca **429**
  `USAGE_LIMIT_EXCEEDED`, więc obserwacja z kodu jest już nieaktualna: limit
  `max_question_banks` **jest** egzekwowany (naprawione w #183, potwierdzone też testem
  integracyjnym `__tests__/integration/plan-limit-enforcement.test.ts`). UI: toast
  „Coś poszło nie tak. Spróbuj ponownie.”, dialog „Nowy bank” zostaje otwarty.
- Krok 5 (pytania) — przy 50 pytaniach `POST /api/v1/questions` zwraca **429**
  `USAGE_LIMIT_EXCEEDED`. UI: toast „Nie udało się zapisać pytania”, dialog „Utwórz
  pytanie” zostaje otwarty (formularz WW wymaga 2 odpowiedzi i zaznaczonej poprawnej).
- Każde odrzucenie pozostawia licznik bez zmian: po próbie nad limitem liczba talii /
  fiszek / banków / pytań jest taka sama jak przed nią.
- `POST /api/v1/flashcards/decks/batch/create` nie sprawdza `max_decks` (tworzy dowolną
  liczbę talii) — używane tylko jako skrót w innych miejscach; ten spec tworzy talie po
  jednej, żeby granica była przechodzona normalną ścieżką.
