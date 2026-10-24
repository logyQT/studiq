# AUT-08 — Logowanie – niepoprawne dane

- id: AUT-08
- priority: P1 krytyczny
- module: AUT – Uwierzytelnianie i sesja
- section: Logowanie
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Wpisz student1@dev.local i hasło „zlehaslo”. Kliknij „Zaloguj się”.
2. Wpisz nieistniejący e-mail nobody@dev.local z dowolnym hasłem.
3. Zostaw puste pola i kliknij „Zaloguj się”.
4. Wpisz STUDENT1@DEV.LOCAL / pass.

## Expected result

- Dla błędnych danych toast/komunikat „Nieprawidłowy adres e-mail lub hasło.” – identyczny dla złego hasła i nieistniejącego konta (brak ujawniania, które istnieje).
- Puste pola → komunikaty „Adres e-mail jest wymagany.” i „Hasło jest wymagane.”
- Wielkość liter w e-mailu: zanotuj, czy logowanie się powiodło (oczekiwane: tak).
