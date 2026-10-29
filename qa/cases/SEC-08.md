# SEC-08 — Edycja cudzych zasobów (IDOR)

- id: SEC-08
- priority: P1 krytyczny
- module: SEC – Autoryzacja i izolacja danych
- section: Uprawnienia ról
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

student1 i student2.

## Prerequisite context (tenant model)

W ręcznym seedzie `student1` (S1) jest członkiem organizacji WSB Merito i ma osobistą
talię „O1S1”, a `student2` (S2) jest studentem **innej** organizacji (UE Wrocław).
Automatyzacja nie używa tych kont ani hasła `pass`: przypadek dostaje własny tenant,
a role S1/S2 odtwarza się w nim tak, aby atak był co najmniej tak silny jak w seedzie
ręcznym.

- S1 (ofiara) = `student`: członek organizacji z systemową rolą `member`, właściciel
  osobistej talii „O1S1” i jednej fiszki w niej (tworzone przez API w jego sesji).
- S2 (atakujący) = `invitee1`: konto studenta zaproszone przez admina organizacji i
  przyjmujące zaproszenie (`POST /api/v1/organization/invites/accept`), czyli
  **członek tej samej organizacji** z tą samą rolą `member`. To warunek silniejszy niż
  ręczny seed: członek organizacji przechodzi już filtr organizacyjny, więc odmowę
  może dać wyłącznie zakres `own` zasobu — to jest właśnie testowana granica IDOR.
- Outsider = `invitee2`: student **bez organizacji** (najbliższy odpowiednik „studenta
  z innej organizacji”, jaki daje profil tenanta) — powtarza oba zapisy jako kontrola
  między-tenantowa.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont ręcznego seeda (`student1@dev.local`, `student2@dev.local`,
hasło `pass`). Każde niezależne uruchomienie dostaje własny, świeżo zaseedowany tenant:

```bash
bun scripts/qa-tenant.ts SEC-08 --fresh
```

- Profil tenanta: `qa/tests/profiles/SEC-08.json` = `"org-limit"` — organizacja z adminem,
  dwoma nauczycielami i członkiem (`member`) oraz **dwoma kontami studentów spoza
  organizacji** (`invitee1`, `invitee2`). Ten profil daje jednocześnie ofiarę wewnątrz
  organizacji i drugie konto studenckie do odegrania S2.
- Klucz tenanta: `tenantKey('qa/cases/SEC-08.md', 'SEC-08#<run>', 'qa-shared')` +
  `tenantId(key, entity)` — ten sam schemat co fixture'y e2e, bez nowego schematu ID.
  Sufiks przebiegu wchodzi też w treść fiszki (`Fiszka S1 <run>`), więc dwa przebiegi
  nigdy nie kolidują.
- Zaproszenie S2 jest tworzone przez admina organizacji (`POST
/api/v1/organization/invites/bulk`, rola `member`) i przyjmowane przez S2 tym samym
  kodem, który zwraca odpowiedź. Wiersz zaproszenia jest jednorazowy, więc spec
  najpierw sprawdza członkostwo S2 w `GET /api/v1/organization/members` — przy
  powtórzeniu na tym samym tenancie (retry / `--repeat-each`) krok zaproszenia jest
  pomijany, a talia i fiszka S1 są odnajdywane po nazwie i treści.
- Izolacja: spec nie czyta ani nie zapisuje globalnych ustawień admina, flag funkcji,
  planów, statystyk platformy ani wierszy singletonowych; nie dotyka innego tenanta.

## Steps

1. Jako student1 zapisz UUID własnej fiszki (O1S1).
2. Jako student2 wykonaj PUT /api/v1/flashcards/<UUID fiszki S1> {front:"hack"}.
3. DELETE /api/v1/flashcards/decks/<UUID talii S1>.

## Expected result

- Odmowa (403/404); fiszka i talia S1 pozostają nietknięte.

## Observed during the suite walk (qa-env-8, shared app 3010 / DB 54421, pl)

- S1 (`student`, rola `member`): `POST /api/v1/flashcards/decks {name:"O1S1"}` → **201**,
  talia `visibility: "personal"`, `created_by` = S1, `organization_id` = organizacja
  tenanta; `POST /api/v1/flashcards {deckId, front, back}` → **201**.
- S2 (`invitee1`, ta sama organizacja, rola `member`): `GET /api/v1/me/orgs` pokazuje
  organizację jako aktywną z `orgRoleName: "member"`.
  - `PUT /api/v1/flashcards/<fiszka S1> {front:"hack"}` → **403 `FORBIDDEN`**,
    koperta `{"success":false,"error":"FORBIDDEN"}` bez `data`, nagłówek
    `x-error-code: FORBIDDEN`.
  - `DELETE /api/v1/flashcards/decks/<talia S1>` → **403 `FORBIDDEN`** (ta sama koperta).
  - Ścieżki sąsiednie tego samego ekranu: `DELETE /api/v1/flashcards/<fiszka S1>` →
    **403**, `PUT /api/v1/flashcards/decks/<talia S1> {name:"hack-deck"}` → **403**.
- Student bez organizacji (`invitee2`, `GET /api/v1/me/orgs` = `[]`): ten sam `PUT` i
  ten sam `DELETE` → **404 `NOT_FOUND`** (wiersz nie jest widoczny przez RLS, więc
  zapis kończy się przed sprawdzeniem zakresu). Oba warianty mieszczą się w oczekiwanym
  „403/404”.
- Brak zmian: S1 nadal odczytuje fiszkę z pierwotnym `front`/`back` i talię „O1S1”
  (`GET /api/v1/flashcards/<id>`, `GET /api/v1/flashcards/decks/<id>` → 200), fiszka
  nadal jest listowana w talii, a `/app/flashcards/<talia>` renderuje nagłówek „O1S1”
  i treść fiszki; tekst „hack” nie występuje.
- Kontrola pozytywna (ten sam tenant, ta sama sesja S1): `PUT` własnej fiszki → **200**,
  utworzenie i usunięcie własnej talii kontrolnej → **201** / **200** — trasy są
  sprawne, a 403/404 to granica własności zasobu, nie awaria endpointu.
