# MGR-ROL-01 — Tworzenie roli – bramka uprawnienia org.role.manage

- id: MGR-ROL-01
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Role (/manage/roles)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

M1, WSB Merito (Launch).

## Steps

1. Kliknij „Nowa rola”, nazwa „Asystent”, opis; zapisz.
2. Edytuj nazwę utworzonej roli.
3. Zaloguj się jako członek organizacji, którego rola nie ma `org.role.manage`,
   i spróbuj wykonać zapis roli.

## Expected result

- Administrator organizacji tworzy i edytuje rolę na planie Launch — bez blokady
  planu i bez prośby o ulepszenie. Bramką zapisu jest uprawnienie
  `org.role.manage`, a rola systemowa `admin` ma je na każdym planie.
- Członek bez `org.role.manage` nie widzi edytora, a bezpośredni zapis
  (`POST`/`PUT`/`DELETE /api/v1/organization/roles…`) zwraca **403**
  `{"success":false,"error":"FORBIDDEN"}`. Lista ról pozostaje dla niego czytelna
  **przez API** (`GET /api/v1/organization/roles` → **200**), a strona
  `/manage/roles` ładuje się pod swoim adresem bez przekierowania: dla członka
  bez żadnego klucza `org.*` renderuje kartę „Brak dostępu w tej organizacji”
  (`AreaGate`), bo od 6b-2 cały obszar `/manage` jest bramkowany uprawnieniem
  (ADR-0015 §7.1, §14.1). Bramką widoku i bramką zapisu jest uprawnienie, nie
  persona.
- Wybrany szablon (D17) zapisuje początkowe uprawnienia roli; `org.admin` nigdy
  nie jest przyznawany szablonem. Klucze `org.*` szablonu zaczną działać, gdy 2b
  zastąpi stare bramki funkcji (`member.manage`, `org.manage` itd.); klucze
  treściowe działają już teraz.
- Członek z **kontem typu manager** i rolą niestandardową bez `org.role.manage`
  ale z `org.member.manage` (preset Asystent) widzi listę ról — bramka obszaru go
  wpuszcza — lecz nie ma „Nowej roli” ani kolumny „Akcje”, a
  `POST /api/v1/organization/roles` zwraca **403** — bramką jest uprawnienie, nie
  typ konta.

## Prerequisite context (tenant model)

Wymaganie wstępne „M1, WSB Merito (Launch)” opisuje ręczny seed, na którym pisano
scenariusz. Zautomatyzowany wariant używa własnego tenanta tego przypadku:

```bash
bun scripts/qa-tenant.ts MGR-ROL-01 --fresh   # nowa organizacja i użytkownicy na każdy przebieg
```

- **Klucz tenanta**: `tenantKey('qa/cases/MGR-ROL-01.md', <caseId>#<run>, 'qa-shared')`
  — z `--fresh` każdy niezależny przebieg ma nowe, ale deterministyczne id
  (`tenantId(key, entity)`).
- **Organizacja**: jedna organizacja tworzona przez trigger na planie **Launch**
  (`organizations.plan`); nie ruszamy globalnego katalogu planów ani flag.
- **Użytkownicy** (hasło `Seed4Test!`): `manager` (manager, rola org `admin`),
  `teacher` (educator, rola org `member`), `student` (student, rola org `member`),
  `roleless` (manager, rola org `member` — przypadek odmowy bramki klienta; rola
  niestandardowa jest mu nadawana przez API w przebiegu).
- **Profil**: `content` z jawnym rosterem `members` w
  `__tests__/qa/profiles/MGR-ROL-01.json` (cztery konta powyżej; roster jest
  deklaratywny, więc seeder nie zgaduje).
- Plan i uprawnienia są odczytywane w tym samym przebiegu przez `/api/v1/me/plan`,
  `/api/v1/me/permissions` i `/api/v1/organization/roles` — nic nie jest zaszyte
  na sztywno.

## Walk observations (2026-11-19, po 2a-2)

- Strona `/manage/roles` **nie wyświetla już** karty „Kreator ról nie jest dostępny
  w Twoim planie”. Karta i cała bramka planu (`role.builder`) zostały usunięte w
  fazie 2a-2; przycisk „Nowa rola”, kolumna „Akcje” i edytor uprawnień są widoczne
  dla administratora na Launch.
- Formularz „Utwórz rolę” ma pola „Nazwa roli”, „Opis (opcjonalny)” i wybór
  „Szablon startowy” (domyślnie „Pusty”). Po zapisie: toast „Rola utworzona”,
  wiersz „Asystent” z plakietką „Niestandardowa”.
- `GET /api/v1/me/permissions` administratora zawiera `org.role.manage`
  (zakres `organization`); dla roli `teacher` klucza nie ma.
- Bezpośredni `POST /api/v1/organization/roles` jako `teacher` zwraca **403**;
  to samo dotyczy `PUT` i `DELETE`. `GET` listy ról zwraca 200 dla obu użytkowników.
- Członek `roleless` (konto typu **manager**, rola niestandardowa „Asystent
  organizacji” bez `org.role.manage`) widzi `/manage/roles` i listę ról, ale bez
  przycisku „Nowa rola” i bez kolumny „Akcje”; `POST /api/v1/organization/roles`
  z jego sesją zwraca 403. To dowód, że edytor jest bramkowany uprawnieniem, a nie
  regułą persony.
- Nauczyciel (account type educator, rola org `member`) **pozostaje** na
  `/manage/roles`: trasa `/manage` wymaga tylko zalogowania (ADR-0015 §7.1), więc
  strona i lista ról się renderują, a uprawnienie `org.role.manage` — nie persona
  — odbiera „Nową rolę”, kolumnę „Akcje” i zapis (`POST`/`PUT`/`DELETE` → 403).

## Walk observations (2026-11-24, po 6b-2)

- **Cały panel `/manage` jest bramkowany uprawnieniem, nie tylko zapis.** Od fazy
  6b-2 layout `/manage` renderuje `AreaGate`: gdy wywołujący nie ma **żadnego** z
  dziewięciu kluczy `org.*`, każdy ekran `/manage/…` — również lista
  `/manage/roles` — pokazuje kartę „Brak dostępu w tej organizacji” (nazwa
  organizacji + akcja przejścia do własnej przestrzeni), a adres URL pozostaje
  bez przekierowania (ADR-0015 §7.1, §14.1). Nauczyciel (konto educator, rola org
  `member`) nie ma żadnego klucza `org.*`, więc **nie widzi już listy ról** na
  stronie; poprzednia obserwacja z 2026-11-19 o renderującej się liście jest tym
  samym nieaktualna, a zapis historyczny pozostaje poniżej.
- **API ról się nie zmieniło i nadal jest czytelne dla członka organizacji.**
  `GET /api/v1/organization/roles` dla nauczyciela zwraca **200** i zawiera
  utworzoną rolę („Asystent organizacji”), `GET /api/v1/organization/roles/:id`
  również 200; zapisy (`POST`, `PUT`, `DELETE …/roles…`) pozostają **403**
  `{"success":false,"error":"FORBIDDEN"}`. Bramką widoku jest więc uprawnienie
  obszaru, a bramką zapisu — `org.role.manage`; persona nie jest już żadną z nich.
- Bez zmian dla administratora (rola `admin` ma wszystkie dziewięć kluczy `org.*`
  na Launch: edytor, „Nowa rola”, kolumna „Akcje”) i dla członka z **kontem typu
  manager** oraz rolą z presetu Asystent (`org.member.manage`): bramka obszaru
  otwiera stronę, a `org.role.manage` odmawia edytora i zapisu.

## Historia przypadku

Wydanie v1.3 opisywało Launch jako plan bez `role.builder`, a krok 1 kończył się
403 i prośbą o zanotowanie, czy UI ostrzega o planie. Naprawa #259 dodała kartę
blokady planu. Faza 2a-2 (ADR-0015 §4.4) zastąpiła bramkę planu uprawnieniem
`org.role.manage`, więc oczekiwany rezultat został przepisany na kontrakt
uprawnienia: administrator na Launch zapisuje, członek bez klucza nie.
