# AUT-20 — Zakładka /manage jako członek organizacji (bez dostępu)

- id: AUT-20
- priority: P1 krytyczny
- module: AUT – Uwierzytelnianie i sesja
- section: Ochrona tras – macierz ról
- prereqs: none
- source: ADR-0015 §7.1 i §14.1 (reguła zakładki), StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany student — członek organizacji, który nie ma żadnego uprawnienia
zarządzania nią.

## Steps

1. Zaloguj się jako student (członek organizacji) i poczekaj na swój pulpit
   (`/app`).
2. Otwórz zapamiętany adres `/manage/members`.
3. Sprawdź adres strony, kartę braku dostępu i dostępną akcję.
4. Sprawdź menu boczne panelu `/manage`.
5. Wywołaj `GET /api/v1/organization/members` oraz
   `PUT /api/v1/organization/members`.
6. Kontrola: zaloguj się jako manager tej organizacji i otwórz
   `/manage/members`.

## Expected result

- **Adres pozostaje `/manage/members`** — strona się ładuje (`200`), nie ma
  przekierowania ani 404. Link jest nawigacją, granicą jest API (§7.1, §14.1).
- Zamiast treści panelu renderuje się karta z tytułem
  **„Brak dostępu w tej organizacji”**, zdaniem nazywającym aktywną organizację
  („Organizacja {nazwa} nie przyznała Ci żadnego uprawnienia w tym obszarze.
  Administrator tej organizacji może je nadać.”) i akcją przełączenia:
  - po jednym przycisku **„Przełącz na {nazwa}”** dla każdej _innej_ organizacji
    użytkownika (przyciski nieaktywne w trakcie przełączania);
  - gdy organizacja jest tylko jedna — link **„Przejdź do swojej przestrzeni”**
    prowadzący do `/app`.
- Tabela członków **nie renderuje się**: brak nagłówków kolumn, brak wierszy,
  brak adresów e-mail innych osób.
- Menu boczne `/manage` nie oferuje pozycji „Członkowie”, „Zaproszenia”,
  „Role”, „Miejsca” ani „Ustawienia”; pozostaje pozycja przeglądu (i „Grupy”,
  bo członek organizacji ma `group.read`).
- `GET /api/v1/organization/members` → **200** z `data: []` (kształt odmowy
  D25 — brak jakichkolwiek danych członków); `PUT /api/v1/organization/members`
  → **403 FORBIDDEN**.
- Kontrola: manager tej samej organizacji widzi na `/manage/members` listę
  członków (w tym studenta) i **nie** widzi karty braku dostępu.

## Seed (QA-suite tenant)

Przypadek nie korzysta z ręcznego seeda (`student1@dev.local`). Potrzebuje
wyłącznie jednej organizacji z managerem, wykładowcą i studentem — czyli
domyślnego profilu `content`, bez pliku profilu:

```bash
bun scripts/qa-tenant.ts AUT-20 --profile content --fresh
```

- Klucz tenanta: `tenantKey('qa/cases/AUT-20.md', 'AUT-20#<run>', 'qa-shared')`
  → `AUT-20.md::AUT-20#<run>::qa-shared`; identyfikatory organizacji, grupy i kont
  pochodzą z `tenantId`, więc są deterministyczne w obrębie przebiegu.
- Konto studenta (`users.student`, hasło `Seed4Test!`) jest członkiem organizacji
  z systemową rolą `member` (profil uprawnień `learner`) — nie ma żadnego klucza
  `org.*`. Konto `users.manager` ma rolę `admin` i służy tylko do kontroli.
- Organizacja tenanta jest **jedna**, dlatego krok 3 assertuje link
  „Przejdź do swojej przestrzeni”, a nie przyciski „Przełącz na …”. Wariant
  wieloorganizacyjny (przycisk przełączenia) jest pokryty przez `MGR-03`.
- Spec: `__tests__/qa/AUT/AUT-20.spec.ts`, projekt
  `__tests__/qa/playwright.qa.config.ts`, baseURL `http://localhost:3010`,
  `NEXT_LOCALE=pl` (kopia interfejsu w tym przypadku jest polska).
- Izolacja: spec czyta wyłącznie własny tenant (strona, menu, roster, jedna
  próba zapisu `PUT`, która musi zostać odrzucona) i nie dotyka innego tenanta,
  flag funkcji, planów, statystyk platformy ani wierszy singletonowych.
