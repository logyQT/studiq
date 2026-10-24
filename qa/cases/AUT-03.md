# AUT-03 — Walidacja hasła – reguły

- id: AUT-03
- priority: P2 ważny
- module: AUT – Uwierzytelnianie i sesja
- section: Rejestracja
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Brak sesji.

## Steps

1. Wpisz poprawne imię, e-mail i typ konta. Kolejno wpisz hasła: „abc” ; „abcdefgh” ; „Abcdefgh” ; „abcdefg1” ; 129 znaków „Aa1…”.
2. Po każdym kliknij „Zarejestruj się”.

## Expected result

- „abc” → „Hasło musi mieć co najmniej 8 znaków.”
- „abcdefgh” → brak wielkiej litery („…co najmniej jedną wielką literę.”) i/lub cyfry.
- „Abcdefgh” → „…co najmniej jedną cyfrę.”
- „abcdefg1” → „…co najmniej jedną wielką literę.”
- 129 znaków → „Hasło nie może przekraczać 128 znaków.”
