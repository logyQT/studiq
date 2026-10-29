# PUB-03 — Strona „Cennik” (/pricing) – kafelki typów kont

- id: PUB-03
- priority: P1 krytyczny
- module: PUB – Strony publiczne i nawigacja ogólna
- section: Funkcje, Cennik, Kontakt, strony prawne
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`manager@dev.local`, `student1@dev.local`, …).
Kafelek cennika jest publiczny, więc przypadek nie potrzebuje zalogowanego użytkownika — jego
izolowany tenant istnieje tylko jako nazwa przypadku i dowód izolacji:

```bash
bun scripts/qa-tenant.ts PUB-03 --reset   # usuń poprzedni tenant
bun scripts/qa-tenant.ts PUB-03           # seed od zera (deterministyczny)
```

- Klucz tenanta: `qa/cases/PUB-03.md::PUB-03::qa-shared` (`tenantKey` + `tenantId`, ten sam
  schemat co fixture'y e2e).
- Organizacja `qa-pub-03-shared` + manager / teacher / student (`Seed4Test!`, hasła z
  `tenant-seed.ts`), grupa `G1`. Reset i seed przed każdym niezależnym przebiegiem.
- Worker QA-suite seeduje **wspólną** bazę (`http://localhost:54421`): przed uruchomieniem
  skryptu eksportuje `NEXT_PUBLIC_SUPABASE_URL` i `SUPABASE_SERVICE_ROLE_KEY` ze shared worktree,
  bo lokalny `apps/web/.env` worktree'a wskazuje na jego własny Supabase.
- Przeglądarka startuje z pustym stanem sesji (`storageState: { cookies: [], origins: [] }`)
  i ustawionym `NEXT_LOCALE=pl`; żaden użytkownik tenanta nie jest zalogowany.
- Spec nie zapisuje żadnych współdzielonych rekordów: katalog planów czyta tylko przez
  publiczne `GET /api/v1/subscription-plans?for=<typ>` i porównuje z nim wyrenderowane karty.

## Steps

1. Otwórz /pricing.
2. Sprawdź trzy kafelki: Student, Edukator, Organizacja.
3. Kliknij kafelek „Student”, wróć, powtórz dla „Edukator” i „Organizacja”.

## Expected result

- Tytuł „Wybierz Swój Plan” i podtytuł „Zacznij za darmo, ulepsz gdy potrzebujesz więcej”.
- Trzy kafelki (Student / Edukator / Organizacja) z ikoną, nazwą i opisem. Cały kafelek jest klikalny (link nakładkowy) — brak osobnego przycisku „Zobacz N plany” i brak licznika planów na kafelku.
- Kliknięcie kafelka „Student” → /pricing/student z 4 planami: Base, Spark, Ace, Pro.
- Kliknięcie kafelka „Edukator” → /pricing/edu z 4 planami: Lite, Guide, Creator, Master.
- Kliknięcie kafelka „Organizacja” → /pricing/org z 4 planami: Launch, Team, Hub, Campus.
- Powrót na /pricing przez link „Cennik” w nagłówku (strona planów nie ma osobnego linku „Powrót do planów”).
