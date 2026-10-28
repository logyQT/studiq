# AUT-07 — Logowanie – każdy typ konta i przekierowanie

- id: AUT-07
- priority: P1 krytyczny
- module: AUT – Uwierzytelnianie i sesja
- section: Logowanie
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji. Hasło wszystkich kont seed: pass.

## Steps

1. Zaloguj się na manager@dev.local / pass → zanotuj adres. Wyloguj.
2. Zaloguj się na teacher1@dev.local / pass → zanotuj adres. Wyloguj.
3. Zaloguj się na student1@dev.local / pass → zanotuj adres. Wyloguj.

## Expected result

- Manager → /manage; nauczyciel → /edu; student → /app.
- W pasku bocznym widoczny odpowiedni zestaw menu (patrz moduły STU/EDU/MGR).
- W menu użytkownika (dół paska bocznego) widoczne imię (M1/T1/S1) i e-mail.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`manager@dev.local`,
`teacher1@dev.local`, `student1@dev.local`, hasło `pass`, skróty M1/T1/S1).
Zamiast tego scenariusz zakłada własny tenant `content` z świeżym sufiksem przebiegu:

```bash
bun scripts/qa-tenant.ts AUT-07 --profile content --fresh
```

- Klucz tenanta: `AUT-07.md::AUT-07#<run>::qa-shared` —
  `tenantKey('qa/cases/AUT-07.md', 'AUT-07#<run>', 'qa-shared')` + `tenantId`, ten
  sam schemat co fixture'y e2e (bez nowego schematu ID).
- Profil `content` tworzy organizację tenanta (`qa-aut-07-<run>`) oraz trzy konta,
  po jednym na każdy typ: manager (`admin`), nauczyciel (edukator) i student. Są
  to odpowiedniki M1/T1/S1 z dokumentu; hasło wszystkich to `Seed4Test!`.
- Nazwy w menu użytkownika to `QA manager` / `QA teacher` / `QA student`, a adresy
  e-mail są deterministyczne per przebieg (`seed-manager-<hash>@dev.local` itd.).
- Izolacja: spec nie czyta ani nie zapisuje globalnych ustawień admina, flag
  funkcji, planów, statystyk platformy ani wierszy singletonowych; nie dotyka
  innego tenanta. Asercje menu nie zależą od planu ani flag — wpisy `ai.chat`
  i `group.manage` nie są przypinane.

## Observed during the suite walk (qa-env-1, shared app 3010 / DB 54421)

- `/login` renderuje kartę „Witaj ponownie” z podtytułem „Zaloguj się, aby
  kontynuować naukę”, polami „Adres e-mail” i „Hasło”, przyciskiem „Zaloguj się”
  oraz linkami „Nie pamiętasz hasła?” i „Nie masz konta? Zarejestruj się”.
- Manager → **`/manage`**, nagłówek „Zarządzanie Uczelnią”, pasek boczny:
  „Główne” (Przegląd) i „Administracja” (Członkowie, Zaproszenia, Grupy,
  Zgłoszenia, Role, Licencje, Ustawienia). Brak wpisów ucznia/nauczyciela.
- Nauczyciel → **`/edu`**, nagłówek „Panel Nauczyciela”, pasek boczny: „Główne”
  (Przegląd), „Treści” (Talie, Tematy, Pytania, Testy, Kartkówki, Zgłoszenia,
  oraz Grupy tylko z funkcją `group.manage`) i „Statystyki” (Treści, Wyniki,
  Aktywność). Brak wpisów managera/ucznia.
- Student → **`/app`**, nagłówek „Moja Nauka”, pasek boczny: „Główne” (Przegląd),
  „Nauka” (Ucz się, Wkuwaj, Sprawdź się, Na żywo), „Treści” (Fiszki, Tematy,
  Pytania, Kartkówki, Zgłoszenia) i „Statystyki” (Treści, Wyniki, Aktywność).
  Brak wpisów managera/nauczyciela.
- W każdym przypadku nagłówek organizacji pokazuje nazwę organizacji tenanta oraz
  rolę w organizacji; `GET /api/v1/auth/me` zwraca e-mail zalogowanego konta i
  `app_metadata.account_type` = `manager` / `educator` / `student`.
- Menu użytkownika na dole paska bocznego pokazuje nazwę i e-mail konta (długi
  seedowy adres jest wizualnie ucinany wielokropkiem, ale pełna wartość jest w
  treści elementu). Pozycja „Wyloguj się” kończy sesję i przenosi na `/login`.
- Po wylogowaniu wejście na adres panelu przekierowuje na
  `/login?next=%2Fmanage` (analogicznie `%2Fedu`, `%2Fapp`) — trasa jest nadal
  chroniona.
- Wejście na `/login` z aktywną sesją przekierowuje na panel właściwy dla typu
  konta (`/manage`, `/edu`, `/app`).
