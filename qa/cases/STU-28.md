# STU-28 — Operacje zbiorcze na fiszkach

- id: STU-28
- priority: P2 ważny
- module: STU – Panel studenta (/app)
- section: Fiszki w talii (/app/flashcards/<id>)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Talia z ≥ 5 fiszkami; druga talia B.

## Steps

1. Kliknij „Wybierz Fiszki”, zaznacz 3 fiszki; sprawdź „Zaznacz Wszystkie”.
2. Wykonaj kolejno: Linkuj (do talii B), Tematy (Ustaw), Przenieś (do B), Kopiuj, Usuń.

## Expected result

- Dla każdej akcji toast: „Fiszki powiązano z taliami”, „Zaktualizowano tematy dla N fiszek”, „Fiszki przeniesiono do nowej talii”, itd.
- Usunięcie: „Usunąć N fiszek?” – „Te fiszki zostaną trwale usunięte…” i usunięcie po potwierdzeniu.
- Licznik w talii źródłowej i docelowej aktualizuje się.
