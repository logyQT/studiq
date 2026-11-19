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
  `{"success":false,"error":"FORBIDDEN"}`. Lista ról pozostaje dla niego czytelna.
- Wybrany szablon (D17) zapisuje początkowe uprawnienia roli; `org.admin` nigdy
  nie jest przyznawany szablonem.

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
  `teacher` (educator, rola org `teacher`), `student` (student, rola org `member`).
- **Profil**: `content` (domyślny, więc bez wpisu w `__tests__/qa/profiles/<CASE>.json`).
- Plan i uprawnienia są odczytywane w tym samym przebiegu przez `/api/v1/me/plan`,
  `/api/v1/permissions/me` i `/api/v1/organization/roles` — nic nie jest zaszyte
  na sztywno.

## Walk observations (2026-11-19, po 2a-2)

- Strona `/manage/roles` **nie wyświetla już** karty „Kreator ról nie jest dostępny
  w Twoim planie”. Karta i cała bramka planu (`role.builder`) zostały usunięte w
  fazie 2a-2; przycisk „Nowa rola”, kolumna „Akcje” i edytor uprawnień są widoczne
  dla administratora na Launch.
- Formularz „Utwórz rolę” ma pola „Nazwa roli”, „Opis (opcjonalny)” i wybór
  „Szablon startowy” (domyślnie „Pusty”). Po zapisie: toast „Rola utworzona”,
  wiersz „Asystent” z plakietką „Niestandardowa”.
- `GET /api/v1/permissions/me` administratora zawiera `org.role.manage`
  (zakres `organization`); dla roli `teacher` klucza nie ma.
- Bezpośredni `POST /api/v1/organization/roles` jako `teacher` zwraca **403**;
  to samo dotyczy `PUT` i `DELETE`. `GET` listy ról zwraca 200 dla obu użytkowników.
- Nauczyciel (account type educator) nadal jest przekierowywany z `/manage` na
  `/edu` przez regułę persony (`AUT-17`), więc edytora nie zobaczy także z tego
  powodu; bramką merytoryczną jest uprawnienie sprawdzane po stronie API.

## Historia przypadku

Wydanie v1.3 opisywało Launch jako plan bez `role.builder`, a krok 1 kończył się
403 i prośbą o zanotowanie, czy UI ostrzega o planie. Naprawa #259 dodała kartę
blokady planu. Faza 2a-2 (ADR-0015 §4.4) zastąpiła bramkę planu uprawnieniem
`org.role.manage`, więc oczekiwany rezultat został przepisany na kontrakt
uprawnienia: administrator na Launch zapisuje, członek bez klucza nie.
