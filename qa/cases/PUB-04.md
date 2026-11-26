# PUB-04 — Cennik dla osoby indywidualnej – plany, porównanie i FAQ

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
Strona cennika jest publiczna, więc przypadek nie potrzebuje zalogowanego użytkownika — jego
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
  worktree, bo lokalny `.env.local` worktree'a wskazuje na jego własny Supabase.
- Przeglądarka startuje z pustym stanem sesji (`storageState: { cookies: [], origins: [] }`)
  i ustawionym `NEXT_LOCALE=pl`; żaden użytkownik tenanta nie jest zalogowany.
- Spec nie zapisuje żadnych współdzielonych rekordów: katalog planów czyta tylko przez
  publiczne `GET /api/v1/subscription-plans` i porównuje z nim wyrenderowane plany, tabelę
  i FAQ.

## Steps

1. Otwórz /pricing (domyślnie wybrane „Dla siebie”).
2. W sekcji „Dla osób indywidualnych” sprawdź kolejno plany Free, Plus, Pro i Max: nazwę,
   cenę, opis i przycisk akcji.
3. Sprawdź tabelę „Porównaj plany” pod planami.
4. Sprawdź FAQ pod tabelą.

## Expected result

- Ceny zgodne z konfiguracją: Free 0 zł (w miejscu ceny słowo „Darmowy”), Plus 19,99 zł,
  Pro 39,99 zł, Max 79,99 zł /miesiąc (wartości z groszy: 1999 → 19,99).
- Plany są wierszami listy (nazwa, opis, cena, przycisk), a nie kartami. Nazwa każdego planu
  jest nagłówkiem i ma kotwicę `#<klucz>` (np. `#ace`).
- Brak sesji: Free ma „Zacznij za darmo”, płatne plany indywidualne mają „Załóż konto”,
  Campus w sekcji organizacji ma „Porozmawiajmy” i prowadzi do /contact. Zalecany plan ma
  zielony przycisk akcji, pozostałe obrysowany.
- Zalogowany czytelnik dostaje akcję zakupu przy każdym płatnym planie indywidualnym: jedna
  drabinka obsługuje każdą personę (#1193). Plan organizacji nadal wymaga organizacji, w której
  czytelnik może rozliczać plan.
- Wyróżnienie „Zalecany” ma dokładnie jeden plan w sekcji: Pro (`ace`).
- Tabela pod sekcją zawiera tylko różnice między planami; nad nią jedna linia
  „Wszystkie plany obejmują: …”. Brak limitu to „—”, a liczby są grupowane (np. 25 000).
  Drabinka indywidualna nie ma wartości -1 i nie zawiera limitów organizacyjnych
  (Maks. studentów, Maks. grup).
- FAQ jest zwinięte. Otwarcie pytania pokazuje odpowiedź, a otwarcie kolejnego zamyka
  poprzednie. Odpowiedzi są w HTML strony również wtedy, gdy są zwinięte.
- Brak sesji nie pokazuje przycisku zakupu ani checkoutu.

## Notatka z przejścia (QA-suite, 2026-10-28, zaktualizowana 2026-11-16)

- Limity nie są wypisane przy planach — znajdują się w tabeli „Porównaj plany” pod planami.
  Tabela indywidualna ma wiersze: Zaawansowane statystyki, Asystent AI, Biblioteka testów,
  Maks. fiszki, Maks. talie, Maks. pytania, Maks. banki pytań, Próby dziennie,
  Tokeny AI / dzień. Limity organizacyjne (Maks. studentów, Maks. grup) pojawiają się tylko
  w sekcji organizacji.
- „Zalecany” to stała per drabinka (Pro / Hub), a nie pole w katalogu planów.
- Ceny i funkcje są globalną konfiguracją planów, więc spec nie wpisuje ich na sztywno:
  pobiera katalog przez `GET /api/v1/subscription-plans` i sprawdza, że plany, tabele i akcje
  renderują dokładnie tę konfigurację (grosze → zł, -1 → „∞”, brak → „—”).
  `documents` jest nieobecny w katalogu do czasu wdrożenia jego powierzchni (open catalog,
  ADR §5.1 / D22), więc tabela go nie zawiera.
