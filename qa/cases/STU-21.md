# STU-21 — Tworzenie fiszki – edytor Markdown

- id: STU-21
- priority: P1 krytyczny
- module: STU – Panel studenta (/app)
- section: Fiszki w talii (/app/flashcards/<id>)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Własna talia.

## Steps

1. Kliknij „Nowa Fiszka”.
2. W polu „Przód (Pytanie)” wpisz „Stolica Polski?”, w „Tył (Odpowiedź)” – „Warszawa”.
3. Użyj paska narzędzi: Pogrubienie, Kursywa, Nagłówek 1–6, lista punktowana/numerowana, Link, Tabela; przełącz „Edytuj/Podgląd”.
4. Zapisz („Utwórz”).

## Expected result

- Toast „Fiszka utworzona pomyślnie”; fiszka widoczna w talii.
- Podgląd renderuje Markdown (pogrubienie, listy, linki, tabela) zgodnie z formatowaniem.
- Przycisk „Link” pyta o URL; po zatwierdzeniu wstawia składnię Markdown.
