# EDU-02 — Menu boczne nauczyciela

- id: EDU-02
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Pulpit i nawigacja
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany teacher1@dev.local.

## Steps

1. Sprawdź i kliknij każdą pozycję menu.

## Expected result

- Sekcje: Główne (Przegląd, Asystent Q), Treści (Talie, Tematy, Pytania, Testy, Kartkówki, Zgłoszenia, Grupy), Statystyki (Treści, Wyniki, Aktywność).
- „Grupy” widoczne tylko gdy plan ma funkcję group.manage (T1 ma – plan Lite).
- Pozycje związane z „Klasą” są ukryte w interfejsie (sekcja zakomentowana).
- ZNANY PROBLEM: „Asystent Q” prowadzi do /edu/ai – sprawdź, czy strona istnieje (spodziewane: 404 „Nie znaleziono strony”, bo zdefiniowano tylko /app/ai).
