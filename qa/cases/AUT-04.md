# AUT-04 — Walidacja imienia i nazwiska

- id: AUT-04
- priority: P2 ważny
- module: AUT – Uwierzytelnianie i sesja
- section: Rejestracja
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Wpisz imię: „A” ; „Jan123” ; „Anna-Maria Nowak” ; „Łukasz Żółć” ; „Jan O'Brien”.
2. Dla każdego uzupełnij pozostałe pola poprawnie i wyślij.

## Expected result

- „A” → „Imię i nazwisko jest za krótkie.”
- „Jan123” → „Imię i nazwisko zawiera niedozwolone znaki.”
- „Łukasz Żółć” (polskie znaki) → akceptowane.
- Zanotuj zachowanie dla „Anna-Maria Nowak” i „Jan O'Brien”: reguła dopuszcza wyłącznie litery i spacje, więc myślnik i apostrof mogą zostać odrzucone (potencjalny problem dla nazwisk dwuczłonowych – zgłoś jako uwagę).
