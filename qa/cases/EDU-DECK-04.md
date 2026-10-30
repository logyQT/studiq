# EDU-DECK-04 — Fiszki w talii nauczyciela – CRUD

- id: EDU-DECK-04
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Talie i fiszki nauczyciela
- prereqs: EDU-DECK-02
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Talia z EDU-DECK-02.

## Prerequisite context

### EDU-DECK-02 — Utworzenie talii dla grupy (źródło warunku)

_Warunek wstępny w oryginale: T1, aktywna organizacja WSB Merito._

1. Kliknij „Nowa talia”. Nazwa „Matematyka – klasa 1”, opis opcjonalny.
2. Zmień „Widoczność” na „Grupy” i wybierz grupę O1G1 w „Wybierz grupy…”.
3. Kliknij „Utwórz”.
4. Zaloguj się jako student1 (O1G1) i sprawdź /app/flashcards.

Expected:

- Toast „Talia utworzona”; talia z plakietką grupy „O1G1”.
- student1 widzi nową talię z etykietą „Podgląd” (bez możliwości edycji).
- student2 (inna organizacja) i student3 (bez organizacji) NIE widzą tej talii.

## Seed (model tenanta)

Scenariusz jest odtwarzany w **własnym tenancie** przypadku, nie na kontach legacy
(`teacher1@dev.local`, `student1`, hasło `pass`). Każde uruchomienie ma świeży suffix:

- `tenantKey('qa/cases/EDU-DECK-04.md', 'EDU-DECK-04#<run>', 'qa-shared')` →
  `tenantId(key, …)` dla organizacji, grupy i kont;
- organizacja `qa-edu-deck-04-<run>`; nauczyciel (`educator`) jest właścicielem
  organizacji z rolą org `teacher` i rolą grupową `teacher` (może udostępniać treści),
  uczeń jest członkiem organizacji i grupy `G1`;
- warunek „Talia z EDU-DECK-02” powstaje przez `POST /api/v1/flashcards/decks`
  („Matematyka – klasa 1”, `visibility: 'group'`, `groupIds: [G1]`) w tym tenancie;
- temat do kroku 3 powstaje przez `POST /api/v1/flashcards/topics` w tym samym tenancie.

Nic globalnego nie jest czytane ani zapisywane: żadne ustawienie admina, flaga
funkcji, plan, statystyka platformy ani wiersz singletonu.

## Steps

1. W widoku talii kliknij „Dodaj fiszkę”, utwórz fiszkę „2+2” / „4”.
2. Edytuj ją, następnie usuń.
3. Powtórz tworzenie, przypisz temat.

## Expected result

- Toasty: „Fiszka utworzona pomyślnie”, „Fiszka zaktualizowana pomyślnie”, „Fiszka usunięta”.
- Wszystkie operacje z STU-21…STU-28 (edytor Markdown, multimedia, tematy, link/kopia, zbiorcze) działają także w panelu nauczyciela.
