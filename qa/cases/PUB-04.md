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
2. W sekcji „Dla uczniów i studentów” sprawdź kolejno plany Base, Spark, Ace i Pro: nazwę,
   cenę, opis i przycisk akcji.
3. Sprawdź tabelę „Porównaj plany” pod planami uczniów.
4. Sprawdź sekcję „Dla edukatorów” i jej tabelę.
5. Sprawdź FAQ pod tabelami.

## Expected result

- Ceny zgodne z konfiguracją: Base 0 zł (w miejscu ceny słowo „Darmowy”), Spark 9,99 zł,
  Ace 19,99 zł, Pro 39,99 zł /miesiąc (wartości z groszy: 999 → 9,99).
- Plany są wierszami listy (nazwa, opis, cena, przycisk), a nie kartami. Nazwa każdego planu
  jest nagłówkiem i ma kotwicę `#<klucz>` (np. `#ace`).
- Brak sesji: Base ma „Zacznij za darmo”, płatne plany uczniów i edukatorów mają „Załóż konto”,
  Campus w sekcji organizacji ma „Porozmawiajmy” i prowadzi do /contact. Zalecany plan ma
  zielony przycisk akcji, pozostałe obrysowany.
- Zalogowany czytelnik dostaje akcję zakupu tylko przy planach swojej rodziny konta. Plan innej
  rodziny (np. plan edukatora czytany przez studenta) zostaje wierszem z nazwą i ceną, ale bez
  przycisku — serwer odmówiłby takiego zakupu jako `FORBIDDEN` (#1274).
- Wyróżnienie „Zalecany” ma zawsze dokładnie jeden plan w sekcji: Ace dla uczniów i Creator
  dla edukatorów.
- Tabela pod każdą sekcją zawiera tylko różnice między planami; nad nią jedna linia
  „Wszystkie plany obejmują: …”. Wartość -1 to „∞”, brak limitu to „—”, a liczby są grupowane
  (np. 200 000). Tabela uczniów nie zawiera limitów organizacyjnych (Maks. studentów,
  Maks. grup).
- FAQ jest zwinięte. Otwarcie pytania pokazuje odpowiedź, a otwarcie kolejnego zamyka
  poprzednie. Odpowiedzi są w HTML strony również wtedy, gdy są zwinięte.
- Brak sesji nie pokazuje przycisku zakupu ani checkoutu.

## Notatka z przejścia (QA-suite, 2026-10-28, zaktualizowana 2026-11-16)

- Limity nie są wypisane przy planach — znajdują się w tabeli „Porównaj plany” pod planami
  sekcji. Tabela uczniów ma wiersze: Zaawansowane statystyki, Asystent AI, Obsługa dokumentów,
  Maks. fiszki, Maks. talie, Maks. pytania, Maks. banki pytań, Próby dziennie, Tokeny AI / dzień.
  Limity organizacyjne (Maks. studentów, Maks. grup) pojawiają się tylko w sekcji edukatorów
  i organizacji.
- „Zalecany” to stała per sekcja (Ace / Creator / Hub), a nie pole w katalogu planów.
- Ceny i funkcje są globalną konfiguracją planów, więc spec nie wpisuje ich na sztywno:
  pobiera katalog przez `GET /api/v1/subscription-plans` i sprawdza, że plany, tabele i akcje
  renderują dokładnie tę konfigurację (grosze → zł, -1 → „∞”, brak → „—”).
