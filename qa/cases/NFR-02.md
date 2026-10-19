# NFR-02 — Zmiana języka (PL ⇄ EN)

- id: NFR-02
- priority: P1 krytyczny
- module: NFR – Wymagania niefunkcjonalne i międzyobszarowe
- section: Język i motyw
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Zalogowany użytkownik.

## Steps

1. W menu użytkownika wybierz „English”, potem „Polski”.
2. Powtórz na stronach publicznych (jeśli dostępny przełącznik) i w panelu admina.

## Expected result

- Po zmianie strona przeładowuje się w wybranym języku (ciasteczko NEXT_LOCALE, ważne rok); przy zaznaczonym aktualnym języku widoczny ✓.
- Wersja angielska nie zawiera polskich fragmentów, a polska – angielskich; liczebniki (fiszka/fiszki/fiszek) odmieniają się poprawnie.
- Język jest zapamiętany po ponownym logowaniu.
