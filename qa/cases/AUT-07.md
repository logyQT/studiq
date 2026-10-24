# AUT-07 — Logowanie – każdy typ konta i przekierowanie

- id: AUT-07
- priority: P1 krytyczny
- module: AUT – Uwierzytelnianie i sesja
- section: Logowanie
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji. Hasło wszystkich kont seed: pass.

## Steps

1. Zaloguj się na manager@dev.local / pass → zanotuj adres. Wyloguj.
2. Zaloguj się na teacher1@dev.local / pass → zanotuj adres. Wyloguj.
3. Zaloguj się na student1@dev.local / pass → zanotuj adres. Wyloguj.

## Expected result

- Manager → /manage; nauczyciel → /edu; student → /app.
- W pasku bocznym widoczny odpowiedni zestaw menu (patrz moduły STU/EDU/MGR).
- W menu użytkownika (dół paska bocznego) widoczne imię (M1/T1/S1) i e-mail.
