# SEC-04 — Manager jednej organizacji nie zarządza inną

- id: SEC-04
- priority: P1 krytyczny
- module: SEC – Autoryzacja i izolacja danych
- section: Izolacja między organizacjami i grupami
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

manager2 (Akademia Górnicza).

## Seed (QA-suite tenant)

Automatyzacja nie używa kont ręcznego seeda (`manager2@dev.local`, `student1@dev.local`,
hasło `pass`). Przypadek dostaje **dwie osobne organizacje** w jednym tenancie, seedowane przez
wspólne helpery e2e (`__tests__/helpers/tenant-seed.ts`) w `test.beforeAll`, więc każde
niezależne uruchomienie startuje od własnych, świeżych kont i organizacji:

- Klucz tenanta: `SEC-04.md::SEC-04 cross-organization isolation::qa-shared::<run>` —
  `tenantKey('qa/cases/SEC-04.md', 'SEC-04 cross-organization isolation', 'qa-shared')` +
  świeży sufiks przebiegu; identyfikatory organizacji, grup, kont i ról to
  `tenantId(key, entity)` (ten sam schemat co fixture'y e2e, bez losowych UUID).
- Organizacja A (`qa-sec-04-a-<suffix>`) — odpowiednik „Akademii Górniczej”: wyłącznie
  manager z rolą organizacyjną `admin`, bez innych członków.
- Organizacja B (`qa-sec-04-b-<suffix>`) — odpowiednik „WSB Merito”: własny manager
  (rola `admin`) oraz student S1 (rola `member`). Jego konto jest celem prób
  międzyorganizacyjnych.
- Konta (hasło `Seed4Test!`):
  - `manager-a` (`qa+<hash>+manager-a@test.local`) — atakujący, admin organizacji A;
  - `manager-b` (`qa+<hash>+manager-b@test.local`) — admin organizacji B, weryfikuje, że
    organizacja B pozostała nietknięta;
  - `student-b` (`qa+<hash>+student-b@test.local`) — student organizacji B, rola `member`
    (odpowiednik `S1`).
- Organizacje mają różną liczbę członków (1 vs 2), więc lista, która wyciekłaby z drugiej
  organizacji, nie może przypadkowo pokryć się z oczekiwaną.
- Spec: `__tests__/qa/SEC/SEC-04.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl` (kopie interfejsu w przypadku są polskie).
- Izolacja: test czyta i próbuje zapisywać wyłącznie w granicach własnego tenanta; poza
  seedem własnych organizacji nic nie zmienia. Nie dotyka flag funkcji, katalogu planów,
  statystyk platformy, ustawień admina ani wierszy singletonowych.

## Steps

1. Wywołaj fetch('/api/v1/organization/members') i sprawdź członków.
2. Spróbuj zmienić rolę użytkownika z WSB Merito: PUT /api/v1/organization/members {targetUserId:<S1 UUID>, newOrgRoleId:<rola>}.
3. Otwórz /api/v1/organization/00000000-0000-4000-8000-000000000001.

## Expected result

- Lista członków obejmuje tylko Akademię Górniczą.
- Próba zmiany roli cudzego użytkownika – odrzucona (403/404).
- Dane innej organizacji niedostępne.

## Observed during the suite walk (qa-env-3, shared app 3010 / DB 54421)

- Krok 1: `GET /api/v1/organization/members` jako admin organizacji A zwraca **jednego**
  członka — własne konto. Konto studenta B (id, e-mail i nazwa) nie występuje w odpowiedzi.
  Strona `/manage/members` pokazuje nagłówek „Członkowie”, licznik „1 łącznie” i wyłącznie
  wiersz managera A; nazwa organizacji B nie pojawia się nigdzie na stronie.
- Krok 2: `PUT /api/v1/organization/members` z `targetUserId` studenta B jest odrzucany
  niezależnie od wskazanej roli:
  - rola `admin` **organizacji A** (cudzy użytkownik, własna rola) → **404 `NOT_FOUND`**
    (użytkownik nie jest członkiem organizacji A),
  - rola `admin` **organizacji B** (cudzy użytkownik, cudza rola) → **403 `FORBIDDEN`**
    (rola nie należy do aktywnej organizacji; sprawdzane przed zapisem),
  - nieistniejący UUID roli → **403 `FORBIDDEN`**.
    Oba kody mieszczą się w oczekiwaniu przypadku (403/404). Po próbach student B nadal ma
    dokładnie jedno członkostwo — w organizacji B, z rolą `member` — a manager A nadal ma
    tylko członkostwo w organizacji A z rolą `admin` (weryfikacja przez API managera B oraz
    odczyt `org_members` klientem service-role).
- Ścieżka sąsiednia: `DELETE /api/v1/organization/members?userId=<student B>` → **404**,
  użytkownik pozostaje członkiem organizacji B. Podstawiona cookie `active_org_id` z id
  organizacji B nie otwiera niczego: `GET /api/v1/organization/members` i
  `GET /api/v1/organization/<B>` zwracają **403** (serwer wyprowadza aktywną organizację
  z rzeczywistego członkostwa, nie z cookie).
- Krok 3: `GET /api/v1/organization/<id organizacji B>` → **403 `FORBIDDEN`**, a treść
  odpowiedzi nie zawiera nazwy organizacji B. Ten sam endpoint dla **własnej** organizacji A
  zwraca **200** z jej nazwą — odrzucenie dotyczy identyfikatora, nie całej trasy.
  Uwaga: dokument podaje zaszyty UUID `00000000-0000-4000-8000-000000000001` z ręcznego
  seeda; w modelu tenantowym organizacja B ma własny deterministyczny UUID, więc test
  używa jej prawdziwego id (a nie losowego/nieistniejącego).
- Izolacja jest symetryczna: manager organizacji B dostaje 403 na odczyt organizacji A i
  odrzucenie przy próbie zmiany roli managera A.
- Produkt zachowuje się zgodnie z oczekiwanym rezultatem przypadku — brak odstępstw
  funkcjonalnych do zgłoszenia.
