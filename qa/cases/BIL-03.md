# BIL-03 — Zakup planu studenta – ścieżka poprawna

- id: BIL-03
- priority: P1 krytyczny
- module: BIL – Plany, rozliczenia i płatność (symulowana)
- section: Zakup planu (checkout)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Konto TS (plan Base). Wejście przez /pricing/student lub /app/upgrade.

## Steps

1. Wybierz plan „Spark” → przycisk zakupu.
2. Na /checkout sprawdź podsumowanie zamówienia (nazwa planu, cena, „Razem”).
3. Wpisz numer karty 4242 4242 4242 4242, ważność 12/30, CVC 123, imię „Test Student”.
4. Kliknij „Zapłać 9,99 zł/miesiąc”.

## Expected result

- Pola formatują się automatycznie (spacje co 4 cyfry, „MM/RR” z ukośnikiem); przycisk „Zapłać” aktywny dopiero po wypełnieniu wszystkich pól (16 cyfr, 5 znaków ważności, 3 cyfry CVC, imię).
- Komunikat „Płatność udana! Przekierowywanie…”, po ok. 2 s strona „Zakup udany!” i po 3 s przejście do panelu.
- Plan użytkownika zmienia się na Spark (BIL-01: limity 500 fiszek, 200 pytań, 50 talii…).
- Ostrzeżenie na stronie: „Zabezpieczone przez StudiQ Pay; brak rzeczywistych opłat w trybie deweloperskim”.
