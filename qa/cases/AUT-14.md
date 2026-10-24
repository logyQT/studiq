# AUT-14 — Wylogowanie

- id: AUT-14
- priority: P1 krytyczny
- module: AUT – Uwierzytelnianie i sesja
- section: Reset hasła, wylogowanie, sesja
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany jako student1.

## Steps

1. Kliknij avatar/nazwę użytkownika w dolnej części paska bocznego.
2. Wybierz „Wyloguj się”.
3. Naciśnij przycisk „Wstecz” przeglądarki.

## Expected result

- Przekierowanie na /login.
- Po cofnięciu strony chronione (/app) nie są dostępne bez ponownego logowania – następuje przekierowanie na /login.
