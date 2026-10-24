# AUT-12 — Zapomniane hasło – wysłanie linku

- id: AUT-12
- priority: P1 krytyczny
- module: AUT – Uwierzytelnianie i sesja
- section: Reset hasła, wylogowanie, sesja
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Otwórz /password/reset.
2. Wpisz student1@dev.local i kliknij „Wyślij link”.
3. Otwórz Inbucket.

## Expected result

- Komunikat „Instrukcje zostały wysłane. Sprawdź swoją skrzynkę e-mail.”
- W Inbucket jest wiadomość z linkiem resetującym.
