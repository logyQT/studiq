# ONB-03 — Dołączenie nauczyciela do istniejącej organizacji kodem

- id: ONB-03
- priority: P2 ważny
- module: ONB – Onboarding, organizacje i zaproszenia
- section: Nauczyciel – konfiguracja klasy
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Kod/token zaproszenia z MGR-INV (rola „teacher”); konto nauczyciela bez organizacji.

## Steps

1. Na /setup wybierz „Dołącz do istniejącej organizacji”.
2. Wklej kod zaproszenia w polu „Kod zaproszenia”.
3. Sprawdź podgląd „Zostałeś zaproszony do …” i kliknij „Dołącz do organizacji”.
4. Powtórz z nieprawidłowym kodem „abc”.

## Expected result

- Poprawny kod → podgląd nazwy organizacji, przycisk „Dołącz do organizacji”, po akceptacji przejście do panelu /edu z organizacją w przełączniku.
- Zły kod → „Ten kod zaproszenia jest nieprawidłowy lub wygasł.”
