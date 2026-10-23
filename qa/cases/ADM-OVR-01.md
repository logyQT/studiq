# ADM-OVR-01 — Utworzenie nadpisania

- id: ADM-OVR-01
- priority: P2 ważny
- module: ADM – Panel administracyjny (apps/admin, port 4000)
- section: Nadpisania użytkowników (/user-overrides)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Znany UUID student1: 00000000-0000-4000-8001-000000000005.

## Steps

1. Kliknij „Utwórz nadpisanie”.
2. Wpisz ID użytkownika, klucz funkcji „ai.chat”, włączone, powód, data wygaśnięcia.
3. Zapisz.

## Expected result

- Nadpisanie widoczne w tabeli: ID użytkownika, klucz, włączone, powód, wygasa.
- Skutek w aplikacji: LIM-07.
