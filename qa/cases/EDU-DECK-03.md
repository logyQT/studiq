# EDU-DECK-03 — Zmiana widoczności talii: Tylko ja ⇄ Grupy

- id: EDU-DECK-03
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Talie i fiszki nauczyciela
- prereqs: EDU-DECK-02
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Talia z EDU-DECK-02.

## Prerequisite context

### EDU-DECK-02 — Utworzenie talii dla grupy

_Warunek wstępny: T1, aktywna organizacja WSB Merito._

1. Kliknij „Nowa talia”. Nazwa „Matematyka – klasa 1”, opis opcjonalny.
2. Zmień „Widoczność” na „Grupy” i wybierz grupę O1G1 w „Wybierz grupy…”.
3. Kliknij „Utwórz”.
4. Zaloguj się jako student1 (O1G1) i sprawdź /app/flashcards.

Expected:

- Toast „Talia utworzona”; talia z plakietką grupy „O1G1”.
- student1 widzi nową talię z etykietą „Podgląd” (bez możliwości edycji).
- student2 (inna organizacja) i student3 (bez organizacji) NIE widzą tej talii.

## Steps

1. Edytuj talię i zmień widoczność na „Tylko ja”.
2. Sprawdź widok studenta1.
3. Przywróć „Grupy”, dodaj drugą grupę (jeśli dostępna) i zapisz.

## Expected result

- Po zmianie na „Tylko ja” student traci dostęp (talia znika z listy).
- Po przywróceniu talia ponownie widoczna.
- Lista grup do wyboru zawiera wyłącznie grupy z aktywnej organizacji.
