# STU-29 — Fiszka z talii nauczyciela – tylko do odczytu

- id: STU-29
- priority: P1 krytyczny
- module: STU – Panel studenta (/app)
- section: Fiszki w talii (/app/flashcards/<id>)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

S1 otwiera talię „O1G1T1” (należącą do T1).

## Prereqs (tenant model)

The case was written against the legacy manual seed (`student1@dev.local` = S1,
`teacher1@dev.local` = T1, password `pass`, deck `O1G1T1` in WSB Merito / group O1G1).
The suite version uses the case's own tenant and never the legacy accounts.

- Profile: `content` (`__tests__/qa/profiles/STU-29.json`) — one organization with its default
  group `G1`, and one account per account type: `manager` (org `admin`, `G1` teacher),
  `teacher` (the case's T1) and `student` (S1, `G1` member).
- Seed: `bun scripts/qa-tenant.ts STU-29 --fresh` — a fresh run suffix per independent run,
  so every run gets its own organization, group and users from
  `tenantKey('qa/cases/STU-29.md', 'STU-29#<suffix>', 'qa-shared')` + `tenantId(key, entity)`.
  The spec reads the ids through `loadTenant('STU-29')`; nothing global is read or written
  (no admin setting, feature flag, plan, platform stat, singleton row or another tenant).
- The seeder enrols `G1` members with the group role `member`; only a group teacher may share
  content to a group, so the spec first promotes T1 to `G1` teacher through the manager's own
  roster write (`PUT /api/v1/organization/groups/<G1>/members`, the same write `/manage/groups`
  performs). Idempotent: a retry finds T1 already teaching `G1`.
- T1 then creates his own deck `O1G1T1`, shared to `G1`, through the product API — the
  `visibility: "group"` deck whose owner he is.
- A card in that deck must carry an official question (`flashcards.question_id`), because the
  product only offers „Zgłoś nieprawidłowość” for cards generated from a question; standalone
  cards have no report thread (`supabase/schemas/30_flashcards.sql`). The spec therefore has
  T1 create the bank `STU-29 bank` (shared to `G1`) with one question and one card in
  `O1G1T1` created with that `questionId`. Empty `question_id` would make the case's report
  point untestable rather than failed.
- Every setup row is looked up by name/content before creation, so a tenant seeded once
  survives `CI=1 --repeat-each=2 --retries=2` (a mismatched card is deleted and recreated by
  its owner).

## Steps

1. Otwórz talię O1G1T1.
2. Sprawdź menu fiszki i dostępne akcje (edycja, usuwanie, nowa fiszka).
3. Spróbuj wejść na /api/v1/flashcards/<id fiszki> metodą PUT/DELETE (np. przez DevTools fetch).

## Expected result

- Etykieta „Podgląd” zamiast „Zarządzaj”; brak możliwości edycji/usuwania cudzej fiszki w interfejsie.
- W menu fiszki dostępna opcja „Zgłoś nieprawidłowość”.
- Wywołanie API modyfikujące cudzą fiszkę zwraca 403/404 (RLS) – dane nie zmieniają się.

## Observed during the suite walk (shared app 3010 / DB 54421, pl, worker qa-env-2)

- Lista `/app/flashcards`: talia T1 jest widoczna (nazwa `O1G1T1`, plakietka grupy `G1`,
  „1 fiszka”), a jej akcja to **„Przeglądaj”** — etykieta trybu tylko do odczytu. To różnica
  wyłącznie kopii (P3) wobec „Podgląd” z dokumentu testera: produkt od zawsze renderuje
  `Common.common_view` = „Przeglądaj” (klucz `view_deck` = „Podgląd” jest nieużywany); znaczenie
  (podgląd zamiast zarządzania) jest spełnione. „Zarządzaj” pojawia się dopiero u właściciela
  talii (T1, `/edu/flashcards`).
- Widok talii `/app/flashcards/<id>`: nagłówek `O1G1T1`, fiszka z treścią, **brak** przycisku
  „Dodaj fiszkę” (u T1 ten sam ekran ma „Dodaj fiszkę”).
- Menu fiszki („Więcej akcji fiszki”) ucznia zawiera dokładnie: „Wybierz Fiszki”,
  „Kopiuj do Innej Talii”, **„Zgłoś nieprawidłowość”** — bez „Edytuj”, „Usuń”, „Tematy” i
  „Przenieś do Innej Talii”. Kliknięcie „Zgłoś nieprawidłowość” otwiera dialog
  „Zgłoś nieprawidłowość pytania” z pustą treścią i wyłączonym „Wyślij”.
- Menu talii („Więcej akcji talii”) ucznia: „Zawieś talię”, „Eksportuj” — bez „Edytuj” i „Usuń”
  (zawieszanie jest preferencją per użytkownik, więc jest dozwolone).
- API jako S1: `PUT /api/v1/flashcards/<fiszka T1>` `{"front":"hack"}` → **403**
  `x-error-code: FORBIDDEN`, koperta `{"success":false,"error":"FORBIDDEN"}` bez `data`;
  `DELETE /api/v1/flashcards/<fiszka T1>` → **403** z tą samą kopertą. Oba mieszczą się w
  oczekiwanym „403/404”.
- Dane nietknięte: `GET /api/v1/flashcards/<id>` po próbach nadal zwraca pierwotny
  `front`/`back`, fiszka renderuje się w talii, a tekst „hack” nie występuje.
- Kontrola pozytywna (ten sam tenant): T1 w `/edu/flashcards` widzi „Zarządzaj” na tej samej
  talii, a w `/edu/flashcards/<id>` ma „Dodaj fiszkę” i menu fiszki z „Edytuj” i „Usuń”;
  `PUT` własnej fiszki → **200**. Zablokowane akcje ucznia to granica własności zasobu, nie
  awaria widoku.
