# MGR-MEM-01 — Lista członków – wyszukiwanie i filtr roli

- id: MGR-MEM-01
- priority: P1 krytyczny
- module: MGR – Panel managera organizacji (/manage)
- section: Członkowie (/manage/members)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

M1, WSB Merito.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont ręcznego seeda (`manager@dev.local`, `T1`, `student1@dev.local`,
hasło `pass`). Przypadek dostaje własny tenant z managerem, nauczycielem, studentem i jednym
członkiem bez imienia; graf jest seedowany przez wspólne helpery e2e
(`__tests__/helpers/tenant-seed.ts`) w `test.beforeAll`, więc każde niezależne uruchomienie
startuje od własnych, świeżych wierszy:

- Klucz tenanta: `MGR-MEM-01.md::MGR-MEM-01 members search and role filter::qa-shared::<run>`
  — `tenantKey('qa/cases/MGR-MEM-01.md', 'MGR-MEM-01 members search and role filter',
'qa-shared')` + świeży sufiks przebiegu; identyfikatory organizacji, grupy i kont to
  `tenantId(key, entity)` (ten sam schemat co fixture'y e2e, bez losowych UUID).
- Organizacja: `qa-mgr-mem-01-<suffix>`, grupa domyślna `G1`.
- Konta (hasło `Seed4Test!`):
  - `manager` — konto managera, rola organizacyjna `admin` (zalogowany użytkownik, wiersz „(ty)”);
  - `teacher` — konto edukatora, rola organizacyjna `teacher`; odpowiednik `T1` z ręcznego seeda;
  - `student` — konto studenta, rola organizacyjna `member`; odpowiednik `S1` (wyszukiwanie po e-mailu);
  - `unnamed` — drugie konto studenta z **pustą nazwą** (stan „Bez imienia”); formularz rejestracji
    wymaga imienia, więc wiersz jest seedowany bezpośrednio, a nie podstawiany odpowiedzią API.
- Spec: `__tests__/qa/MGR/MGR-MEM-01.spec.ts`, projekt `qa/playwright.qa.config.ts`, baseURL
  `http://localhost:3010`, `NEXT_LOCALE=pl` (kopie interfejsu w przypadku są polskie).
- Izolacja: test czyta wyłącznie listę członków i role własnej organizacji oraz jej stan
  w `/manage/members`; poza seedem własnego tenanta nic nie zapisuje. Nie dotyka flag funkcji,
  katalogu planów, statystyk platformy, ustawień admina ani wierszy singletonowych.

## Steps

1. Otwórz /manage/members.
2. Wpisz „T1” w „Szukaj członków…”, potem e-mail student1.
3. Użyj „Filtruj po roli” – „Wszystkie role”, „Nauczyciel”, „Członek”.

## Expected result

- Tabela: Członek, Rola, Dołączył, Grupy, Akcje; licznik „N łącznie”.
- Wyszukiwanie po imieniu i e-mailu (bez wielkości liter); filtr roli zawęża listę.
- Przy własnym koncie adnotacja „(ty)”; brak imienia → „Bez imienia”.

## Observed during the suite walk (qa-env-6, shared app 3010 / DB 54421)

- Po zalogowaniu manager trafia na `/manage`; `/manage/members` renderuje nagłówek
  „Członkowie” i licznik w prawym górnym rogu (`{N} łącznie`). Licznik pokazuje **wszystkich**
  członków organizacji i nie zmienia się przy wyszukiwaniu ani filtrowaniu.
- Tabela ma pięć kolumn: **Członek, Rola, Grupy, Dołączył, Akcje**. Dokument wymienia
  „Dołączył” przed „Grupy”; kolumna „Grupy” została wstawiona przed „Dołączył” wraz z RBAC i
  od tego czasu tak renderuje się lista. Wszystkie wymagane kolumny istnieją i mają właściwą
  treść, więc spec utrwala **zbiór** nagłówków, a nie kolejność z nieaktualnego opisu.
- Wyszukiwanie („Szukaj członków…”) działa po imieniu i nazwisku oraz po e-mailu, bez
  wielkości liter (zapytanie `TEACHER` znajduje „QA teacher”; e-mail studenta znaleziony
  wielkimi literami). Wyszukiwanie i filtr roli łączą się przez AND; brak dopasowań zostawia
  pusty wiersz tabeli. Kopia stanu „brak wyników” zależy od wersji wspólnego builda (#675),
  więc test asertuje liczbę wierszy, nie tekst komunikatu.
- Filtr „Filtruj po roli” oferuje: **Wszystkie role, Admin, Student, Teacher** — etykiety to
  `display_name` ról systemowych (angielskie w całej aplikacji), a nie „Nauczyciel”/„Członek”
  z dokumentu. To dryf językowy P3 (dokument klasyfikuje rozbieżności tekstów jako uwagi
  językowe, nie błędy działania); filtrowanie działa: `Teacher` → 1 wiersz, `Student` → 2,
  `Wszystkie role` → 4.
- Wiersz własnego konta pokazuje „(ty)” w kolumnie Akcje i **nie** oferuje wyboru roli,
  „Zarządzaj grupami” ani usunięcia; pozostałe wiersze mają combobox roli, „Zarządzaj grupami”
  i przycisk „Usuń członka {imię lub e-mail}”.
- Kolumna Rola renderuje `displayName` roli („Admin”, „Teacher”, „Student”), kolumna Grupy —
  badge z nazwą grupy (`G1`), kolumna Dołączył — datę `dd.MM.rrrr`.
- Członek bez nazwy pokazuje „Bez imienia”, a pod nim swój e-mail; konto z pustą nazwą jest
  częścią tenanta, więc stan jest sprawdzany na prawdziwym wierszu listy.
