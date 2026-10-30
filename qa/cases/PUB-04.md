# PUB-04 — Podstrona planów (/pricing/student) – karty planów

- id: PUB-04
- priority: P2 ważny
- module: PUB – Strony publiczne i nawigacja ogólna
- section: Funkcje, Cennik, Kontakt, strony prawne
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`manager@dev.local`, `student1@dev.local`, …).
Strona planów jest publiczna, więc przypadek nie potrzebuje zalogowanego użytkownika — jego
izolowany tenant istnieje tylko jako nazwa przypadku i dowód izolacji:

```bash
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:54421
export SUPABASE_SERVICE_ROLE_KEY=<service-role-key ze shared worktree>
bun scripts/qa-tenant.ts PUB-04 --reset   # usuń poprzedni tenant
bun scripts/qa-tenant.ts PUB-04 --run <sufiks>   # świeży tenant dla jednego przebiegu
```

- Klucz tenanta: `qa/cases/PUB-04.md::PUB-04::qa-shared` (`tenantKey` + `tenantId`, ten sam
  schemat co fixture'y e2e); z sufiksem przebiegu `PUB-04#<sufiks>`.
- Profil `content`: organizacja `qa-pub-04-<sufiks>` + manager / teacher / student
  (`Seed4Test!`, hasła z `tenant-seed.ts`), grupa `G1`. Świeży tenant przed każdym
  niezależnym przebiegiem.
- Worker QA-suite seeduje **wspólną** bazę (`http://localhost:54421`): przed uruchomieniem
  skryptu eksportuje `NEXT_PUBLIC_SUPABASE_URL` i `SUPABASE_SERVICE_ROLE_KEY` ze shared
  worktree, bo lokalny `apps/web/.env` worktree'a wskazuje na jego własny Supabase.
- Przeglądarka startuje z pustym stanem sesji (`storageState: { cookies: [], origins: [] }`)
  i ustawionym `NEXT_LOCALE=pl`; żaden użytkownik tenanta nie jest zalogowany.
- Spec nie zapisuje żadnych współdzielonych rekordów: katalog planów czyta tylko przez
  publiczne `GET /api/v1/subscription-plans?for=student` i porównuje z nim wyrenderowane
  karty oraz tabelę limitów.

## Steps

1. Otwórz /pricing/student.
2. Dla każdej karty sprawdź: nazwę, cenę, listę funkcji i limitów, przycisk CTA.

## Expected result

- Ceny zgodne z konfiguracją: Base 0 zł; Spark 9,99 zł; Ace 19,99 zł; Pro 49,99 zł /miesiąc (wartości wyświetlane z groszy: 999 → 9,99).
- Funkcje: Base – Fiszki, Testy; Ace/Pro – dodatkowo Asystent AI i Zaawansowane Statystyki.
- Limity wyświetlane czytelnie, „Bez ograniczeń” dla wartości -1.
- CTA różni się per plan (np. „Zacznij za Darmo”, „Przejdź na Spark”, „Wybierz Ace”, „Wybierz Pro”).
- Plan „Ace”/„Pro” ma wyróżnienie „Najpopularniejszy” (jeśli skonfigurowane).

## Notatka z przejścia (QA-suite, 2026-10-28)

- Limity nie są wypisane na kartach planów — znajdują się w tabeli „Porównaj Plany” pod
  kartami (wiersze: Maks. fiszki, Maks. talie, Maks. pytania, Maks. banki pytań,
  Próby dziennie, Tokeny AI / dzień). Dla planu studenckiego tabela nie pokazuje limitów
  organizacyjnych (Maks. studentów, Maks. grup), bo nie dotyczą planu osobistego.
- „Najpopularniejszy” ma zawsze plan Ace (stała per typ konta, nie pole w katalogu planów).
- Ceny i funkcje są globalną konfiguracją planów, więc spec nie wpisuje ich na sztywno:
  pobiera katalog przez `GET /api/v1/subscription-plans?for=student` i sprawdza, że karty,
  tabela limitów i CTA renderują dokładnie tę konfigurację (grosze → zł, -1 → „Bez
  ograniczeń”).
