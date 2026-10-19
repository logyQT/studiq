# NFR-06 — Zachowanie przy braku sieci i błędach serwera

- id: NFR-06
- priority: P2 ważny
- module: NFR – Wymagania niefunkcjonalne i międzyobszarowe
- section: Wydajność i stabilność
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

DevTools → Network.

## Steps

1. Ustaw „Offline” i wykonaj: zapis fiszki, utworzenie talii, odpowiedź w quizie, zapis oceny.
2. Przywróć sieć i powtórz akcje.
3. Zablokuj wybrane żądanie API (Request blocking) i obserwuj ekran.

## Expected result

- Każda akcja pokazuje czytelny błąd (toast), dane wpisane w formularzu nie giną, aplikacja nie zawiesza się.
- Po przywróceniu sieci akcja przechodzi bez ponownego wpisywania lub z minimalną stratą.
