# EDU-DECK-01 — Hub fiszek (/edu/flashcards)

- id: EDU-DECK-01
- priority: P2 ważny
- module: EDU – Panel nauczyciela (/edu)
- section: Talie i fiszki nauczyciela
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany teacher1@dev.local.

## Steps

1. Otwórz /edu/flashcards.
2. Sprawdź listę talii, filtr zakresu (Wszystkie / Moje) i filtr grup.

## Expected result

- Tytuł „Talie fiszek”, filtr zakresu: Wszystkie / Moje oraz jeden filtr grup z placeholderem „Dowolna grupa” (i akcją „Moje grupy”, gdy użytkownik należy do grup). Brak opcji „Grupy” i „Udostępnione”.
- T1 widzi własne talie (O1G1T1, O2G1T1 zależnie od aktywnej organizacji) z plakietkami grup.
- Talie T2 (O1G2T2) widoczne zgodnie z regułami uprawnień (zanotuj – oczekiwane: tylko jeśli T1 ma dostęp organizacyjny).
