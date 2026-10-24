# EDU-Q-05 — Edycja i usuwanie pytań

- id: EDU-Q-05
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Banki pytań i pytania (/edu/questions)
- prereqs: EDU-Q-02
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Pytania z EDU-Q-02…05.

## Prerequisite context

### EDU-Q-02 — Pytanie wielokrotnego wyboru
_Warunek wstępny: Bank „Fizyka”._
1. Kliknij „Utwórz pytanie”, typ „Wielokrotny wybór”.
2. Wpisz treść, dodaj 4 odpowiedzi („Dodaj odpowiedź”), zaznacz poprawną radiem, dodaj wyjaśnienie i temat.
3. Zapisz.

Expected:
- Pytanie pojawia się w tabeli z typem „Wielokrotnego wyboru”, liczbą odpowiedzi, tematem.
- Dokładnie jedna odpowiedź oznaczona jako poprawna.

## Steps

1. Edytuj pytanie (zmień poprawną odpowiedź), zapisz.
2. Usuń pytanie, potwierdź „Usunąć pytanie?”.

## Expected result

- Toasty „Pytanie zaktualizowane” / „Pytanie usunięte”.
- Usunięcie pytania użytego w quizie/kartkówce: zanotuj zachowanie (pytanie znika z quizu lub operacja zablokowana).
