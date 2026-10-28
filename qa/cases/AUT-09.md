# AUT-09 — Logowanie – parametr next (powrót do żądanej strony)

- id: AUT-09
- priority: P2 ważny
- module: AUT – Uwierzytelnianie i sesja
- section: Logowanie
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Będąc wylogowanym, otwórz bezpośrednio /app/flashcards.
2. Zaloguj się jako student1@dev.local.

## Expected result

- Najpierw przekierowanie na /login?next=%2Fapp%2Fflashcards.
- Po zalogowaniu użytkownik trafia dokładnie na /app/flashcards.

## Seed (QA-suite tenant)

Automatyzacja nie używa konta `student1@dev.local` z ręcznego seeda. Przypadek
korzysta z własnego, izolowanego tenanta (schemat `tenantKey`/`tenantId` wspólny z
e2e), a student jest zwykłym członkiem jego organizacji — ten sam kształt co S1:

```bash
bun scripts/qa-tenant.ts AUT-09 --profile content --fresh
```

- Klucz tenanta: `AUT-09.md::AUT-09#<run>::qa-shared` —
  `tenantKey('qa/cases/AUT-09.md', 'AUT-09#<run>', 'qa-shared')`, bez nowego
  schematu ID.
- Profil `content`: menedżer, nauczyciel i student w organizacji `qa-aut-09-<run>`
  oraz domyślna grupa `G1`. Spec czyta dane logowania z
  `qa/.tenants/AUT-09.json` (`users.student`, hasło `Seed4Test!`) i nie tworzy
  kont samodzielnie.
- `--fresh` dla każdego niezależnego uruchomienia: świeży sufiks w kluczu, więc
  adresy i identyfikatory są deterministyczne w obrębie przebiegu, a kolejne
  przebiegi nie kolidują ze sobą ani z innymi tenantami.
- Izolacja: spec nie czyta ani nie zapisuje globalnych ustawień admina, flag
  funkcji, planów, statystyk platformy ani wierszy singletonowych; nie dotyka
  innego tenanta. Asercje dotyczą wyłącznie przekierowań i własnej strony
  studenta (pusta lista talii należy do tenanta).

## Observed during the suite walk (shared app 3010 / DB 54421, pl)

- Wylogowany `GET /app/flashcards` → **307** z `location:
/login?next=%2Fapp%2Fflashcards`; przeglądarka kończy na dokładnie tym adresie,
  a formularz pokazuje „Witaj ponownie”, „Adres e-mail”, „Hasło”, „Zaloguj się”.
- Logowanie przez formularz (konto studenta tenanta) kończy się dokładnie na
  `/app/flashcards` (bez query stringa); strona renderuje breadcrumb
  „Moja Nauka › Fiszki”, filtr „Wszystkie / Dowolna grupa” i przycisk
  „Nowa talia”, a lista talii jest pusta („0 talii”).
- Zalogowany użytkownik otwierający `/login?next=%2Fapp%2Fflashcards` również
  trafia na `/app/flashcards` — proxy respektuje `next` także dla sesji, która
  już istnieje (#458), więc odświeżenie/cofnięcie po logowaniu nie gubi celu.
- Zewnętrzny cel (`/login?next=https%3A%2F%2Fevil.example%2Fapp`) jest odrzucany
  przez wspólną walidację `toSafeInternalPath`: po zalogowaniu użytkownik trafia
  na swój panel `/app`, a nie na obcy origin.
