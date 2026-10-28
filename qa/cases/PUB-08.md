# PUB-08 — 404 wewnątrz paneli (student / nauczyciel / manager)

- id: PUB-08
- priority: P2 ważny
- module: PUB – Strony publiczne i nawigacja ogólna
- section: Obsługa błędów i zasoby techniczne
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany kolejno jako S1, T1, M1.

## Prerequisite context (legacy seed)

- S1 = `student1@dev.local` — student w organizacji WSB Merito, grupa O1G1.
- T1 = `teacher1@dev.local` — nauczyciel w WSB Merito, grupy O1G1/O2G1.
- M1 = `manager@dev.local` — admin WSB Merito i UE Wrocław.

## Seed (QA-suite tenant)

Automatyzacja nie używa kont z ręcznego seeda (`student1@`, `teacher1@`,
`manager@dev.local`, hasło `pass`). Każde niezależne uruchomienie dostaje własny,
świeżo zaseedowany tenant o tym samym kształcie co seed ręczny (jedna organizacja:
admin + nauczyciel + student):

```bash
bun scripts/qa-tenant.ts PUB-08 --fresh
```

- Profil tenanta: `qa/tests/profiles/PUB-08.json` = `{"profile": "content"}`.
- Klucz tenanta: `PUB-08.md::PUB-08#<run>::qa-shared` —
  `tenantKey('qa/cases/PUB-08.md', 'PUB-08#<run>', 'qa-shared')` + `tenantId`, ten
  sam schemat co fixture'y e2e (bez nowego schematu ID).
- Mapowanie starych skrótów: S1 → `users.student`, T1 → `users.teacher`,
  M1 → `users.manager` (admin organizacji). Hasło startowe `Seed4Test!`.
  `--fresh` nadaje nowy sufiks przebiegu, więc każdy przebieg dostaje świeżą
  organizację, a identyfikatory pozostają deterministyczne w jego obrębie.
- Przypadek nie potrzebuje żadnej treści (fiszki, banki, quizy) ani płatnego
  planu: sprawdza wyłącznie ekrany 404 i układ paneli.
- Spec: `qa/tests/PUB/PUB-08.spec.ts`, projekt `qa/playwright.qa.config.ts`,
  baseURL `http://localhost:3010`, `NEXT_LOCALE=pl` (dokument cytuje polskie
  napisy).
- Izolacja: test czyta wyłącznie własny graf organizacji tenanta (członkostwo i
  e-mail zalogowanego użytkownika w sidebarze). Nie dotyka ustawień admina, flag
  funkcji, katalogu planów, statystyk platformy ani wierszy singletonowych i nie
  zapisuje niczego w bazie.

## Steps

1. Jako student1 otwórz /app/nie-istnieje.
2. Jako teacher1 otwórz /edu/nie-istnieje.
3. Jako manager otwórz /manage/nie-istnieje.

## Expected result

- Student: „No to niezłe combo…” z linkami do Fiszki / Quiz / Statystyki.
- Nauczyciel: „Nie znaleziono strony” z linkami Przegląd / Pytania / Fiszki / Statystyki.
- Manager: „Nie znaleziono strony” z linkami Przegląd / Członkowie / Zaproszenia / Ustawienia.
- Układ panelu (sidebar) pozostaje widoczny.

## Observed during the suite walk (shared app 3010 / DB 54421, pl, 2026-10-28)

- Wszystkie trzy adresy (`/app/nie-istnieje`, `/edu/nie-istnieje`,
  `/manage/nie-istnieje`) odpowiadają dokumentem **404** (nie 200 z treścią 404 i
  nie przekierowaniem na panel) i renderują się wewnątrz układu panelu.
- Student: nagłówek `404`, tytuł „No to niezłe combo...”, opis „Ta strona nie
  istnieje. Może to literówka, a może po prostu eksplorujesz. W obu przypadkach
  zgubiłeś się.”, etykieta „Albo spróbuj jednego z tych:”, linki **Fiszki**
  (`/app/flashcards`), **Quiz** (`/app/study`), **Statystyki**
  (`/app/stats/content`) oraz „Wróć do panelu” (`/app`).
- Nauczyciel: tytuł „Nie znaleziono strony”, opis „Strona, której szukasz, nie
  istnieje lub została przeniesiona.”, etykieta „Przejdź do:”, linki **Przegląd**
  (`/edu`), **Pytania** (`/edu/questions`), **Fiszki** (`/edu/flashcards`),
  **Statystyki** (`/edu/statistics`). Linku „Klasa” nie ma — zgodnie z decyzją
  produktową #292 (`/edu/classroom` nie ma strony docelowej).
- Manager: tytuł „Nie znaleziono strony”, opis „Żądana strona nie została
  znaleziona. Sprawdź adres URL lub przejdź do innej sekcji.”, etykieta
  „Przejdź do:”, linki **Przegląd** (`/manage`), **Członkowie**
  (`/manage/members`), **Zaproszenia** (`/manage/invites`), **Ustawienia**
  (`/manage/settings`).
- Sidebar pozostaje widoczny w każdym panelu, z e-mailem zalogowanego użytkownika
  tenanta; nagłówek panelu pokazuje etykietę „Moja Nauka” / „Panel Nauczyciela” /
  „Zarządzanie Uczelnią”.
- Wszystkie linki „Przejdź do”/„Albo spróbuj…” prowadzą do działających stron
  (**200**); `/app/study` przekierowuje klientowo na `/app/study/learn`.
- Głębsza nieistniejąca ścieżka w panelu (`/…/nie-istnieje/glebiej`) również
  trafia w catch-all panelu i zachowuje sidebar.
