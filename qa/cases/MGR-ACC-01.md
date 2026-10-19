# MGR-ACC-01 — Menu użytkownika managera – Konto, Płatności, Wybierz plan

- id: MGR-ACC-01
- priority: P1 krytyczny
- module: MGR – Panel managera organizacji (/manage)
- section: Zgłoszenia i konto managera
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

M1. W kodzie istnieje tylko strona /manage/billing – brak /manage/account i /manage/upgrade.

## Steps

1. Otwórz menu użytkownika (dół paska bocznego).
2. Kliknij kolejno „Wybierz plan”, „Konto”, „Płatności”.

## Expected result

- „Płatności” → /manage/billing: strona rozliczeń z aktualnym planem.
- OCZEKIWANY DEFEKT DO POTWIERDZENIA: „Konto” (/manage/account) i „Wybierz plan” (/manage/upgrade) prowadzą do strony „Nie znaleziono strony” – manager nie ma ekranu zmiany nazwy/hasła ani wyboru planu. Zgłoś jako błąd (priorytet wysoki), jeśli potwierdzisz.
- Dla porównania: nauczyciel ma /edu/account i /edu/upgrade, student /app/account i /app/upgrade.
